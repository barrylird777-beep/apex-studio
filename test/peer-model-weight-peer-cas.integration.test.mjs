import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign as signBytes, verify as verifyBytes } from 'node:crypto';
import { encodeCanonical, decodeCanonical } from '../src/core/apex-cbor.mjs';
import { PeerContentAddressedStore, createPeerObjectStorageHandler } from '../src/core/peer-content-addressed-store.mjs';
import { publishPeerModelWeights, fetchPeerModelWeights } from '../src/core/peer-model-weight-distributor.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function mesh() {
  const peers = ['weight-peer-a', 'weight-peer-b'];
  const keyPairs = Object.fromEntries(peers.map(id => [id, generateKeyPairSync('ed25519')]));
  const receiptPublicKeysByPeerId = Object.fromEntries(peers.map(id => [id, keyPairs[id].publicKey.export({ format: 'der', type: 'spki' }).toString('base64')]));
  const objects = new Map(peers.map(id => [id, new Map()]));
  const unavailable = new Set();
  const handlers = new Map(peers.map(id => [id, createPeerObjectStorageHandler({
    peerId: id,
    store: {
      async putBytes(hash, input) {
        const bytes = Buffer.from(input);
        if (sha256(bytes) !== hash) throw new Error('hash mismatch');
        objects.get(id).set(hash, bytes);
        return { hash, bytes: bytes.length };
      },
      async getBytes(hash) {
        const bytes = objects.get(id).get(hash);
        if (!bytes) throw new Error('not found');
        return Buffer.from(bytes);
      },
      async readRef(namespace, key) { return refs.get(id + ':' + namespace + ':' + key) ?? null; },
      async writeRef(namespace, key, expectedHash, hash, bytes) {
        const k = id + ':' + namespace + ':' + key;
        if ((refs.get(k)?.hash ?? null) !== expectedHash) throw new Error('CAS conflict');
        refs.set(k, { hash, bytes: Buffer.from(bytes) });
        return { hash };
      },
      async health({ namespace, peerId: requestedPeer, operation = 'storage.health', objectHash = null, key = null }) {
        const claims = { version: 1, peerId: requestedPeer, namespace, operation, objectHash, key,
          ownership: 'peer-owned', durable: true, atomicReferencesVerified: true, restartRecoveryVerified: true };
        const body = encodeCanonical(claims);
        return { ...claims, receipt: { algorithm: 'Ed25519', body: body.toString('base64'),
          signature: signBytes(null, body, keyPairs[id].privateKey).toString('base64') },
          receiptId: sha256(body) };
      },
      async verifyDurabilityReceipt(receipt, claims) {
        try {
          const body = Buffer.from(receipt.body, 'base64');
          const signed = decodeCanonical(body);
          return receipt.algorithm === 'Ed25519' && body.toString('base64') === receipt.body &&
            verifyBytes(null, body, keyPairs[id].publicKey, Buffer.from(receipt.signature, 'base64')) &&
            claims.peerId === id && claims.namespace === 'KernelVision' &&
            claims.restartRecoveryVerified === true && claims.atomicReferencesVerified === true &&
            signed.peerId === id && signed.namespace === claims.namespace;
        } catch { return false; }
      }
    },
    authorizeNamespace: ({ remotePeerId, namespace }) =>
      remotePeerId === 'weight-writer' && namespace === 'KernelVision'
  })]));
  const refs = new Map();
  const transport = { async request(id, envelope) {
    if (unavailable.has(id)) throw new Error('peer unavailable');
    return handlers.get(id)(envelope, { remotePeerId: 'weight-writer' });
  }};
  const store = new PeerContentAddressedStore({
    transport, peers, replicaCount: 2, minFailureDomains: 2,
    failureDomainsByPeerId: { 'weight-peer-a': 'domain-a', 'weight-peer-b': 'domain-b' },
    namespace: 'KernelVision', encryptionKey: Buffer.alloc(32, 19), receiptPublicKeysByPeerId
  });
  return { store, unavailable, objects };
}

test('model weights transfer through peer CAS with in-memory peer transport, verify integrity, and survive simulated peer loss', async () => {
  const network = mesh();
  const source = Buffer.alloc(24 * 1024, 73);
  const manifest = await publishPeerModelWeights(network.store, source, {
    modelId: 'smollm2', revision: 'test-r1'
  });
  assert.equal(manifest.chunkCount, 3);
  assert.equal(network.objects.get('weight-peer-a').size > 0, true);
  assert.equal(network.objects.get('weight-peer-b').size > 0, true);

  network.unavailable.add('weight-peer-a');
  const fetched = await fetchPeerModelWeights(network.store, manifest, {
    authorizeModel: ({ namespace, modelId, revision }) =>
      namespace === 'KernelVision' && modelId === 'smollm2' && revision === 'test-r1'
  });
  assert.deepEqual(fetched, source);
  assert.equal(sha256(fetched), manifest.contentSha256);
});
