import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PeerContentAddressedStore, createPeerObjectStorageHandler } from '../src/core/peer-content-addressed-store.mjs';
import { publishPeerModelWeights, fetchPeerModelWeights } from '../src/core/peer-model-weight-distributor.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function mesh() {
  const peers = ['weight-peer-a', 'weight-peer-b'];
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
      async prepareRef({ transactionId, namespace, key, expectedHash, hash, bytes, participants }) {
        const prior = transactions.get(id + ':' + transactionId);
        if (prior) return { transactionId, state: prior.state, hash: prior.hash };
        if ((refs.get(id + ':' + namespace + ':' + key)?.hash ?? null) !== expectedHash) throw new Error('prepare CAS conflict');
        await this.putBytes(hash, bytes);
        const tx = { transactionId, namespace, key, expectedHash, hash, bytes: Buffer.from(bytes), participants: [...participants].sort(), state: 'prepared' };
        transactions.set(id + ':' + transactionId, tx);
        return { transactionId, state: tx.state, hash };
      },
      async decideRefCommit(transactionId, participants) {
        const tx = transactions.get(id + ':' + transactionId);
        if (!tx || JSON.stringify([...participants].sort()) !== JSON.stringify(tx.participants)) throw new Error('prepare/participant mismatch');
        if (tx.state === 'prepared') tx.state = 'commit-decided';
        return { transactionId, state: tx.state, hash: tx.hash };
      },
      async commitPreparedRef(transactionId) {
        const tx = transactions.get(id + ':' + transactionId);
        if (!tx || !['commit-decided', 'committed'].includes(tx.state)) throw new Error('missing commit decision');
        const k = id + ':' + tx.namespace + ':' + tx.key;
        const current = refs.get(k);
        if ((current?.hash ?? null) === tx.expectedHash) refs.set(k, { hash: tx.hash, bytes: Buffer.from(tx.bytes) });
        else if (current?.hash !== tx.hash) throw new Error('commit divergence');
        tx.state = 'committed';
        return { transactionId, state: tx.state, hash: tx.hash };
      },
      async abortPreparedRef(transactionId) {
        const tx = transactions.get(id + ':' + transactionId);
        if (!tx) return { transactionId, state: 'absent' };
        if (tx.state !== 'prepared' && tx.state !== 'aborted') throw new Error('cannot abort decided transaction');
        tx.state = 'aborted';
        return { transactionId, state: tx.state };
      },
      async getRefTransaction(transactionId) {
        const tx = transactions.get(id + ':' + transactionId);
        if (!tx) return null;
        const { transactionId: txId, namespace, key, expectedHash, hash, participants, state } = tx;
        return { transactionId: txId, namespace, key, expectedHash, hash, participants, state };
      },
      async health({ namespace, peerId: requestedPeer }) {
        return { durable: true, ownership: 'peer-owned', restartRecoveryVerified: true,
          atomicReferencesVerified: true, peerId: requestedPeer, namespace,
          receipt: 'receipt-' + id, receiptId: 'receipt-id-' + id };
      },
      async verifyDurabilityReceipt(receipt, claims) {
        return receipt === 'receipt-' + id && claims.peerId === id &&
          claims.namespace === 'KernelVision' && claims.restartRecoveryVerified === true &&
          claims.atomicReferencesVerified === true;
      }
    },
    authorizeNamespace: ({ remotePeerId, namespace }) =>
      remotePeerId === 'weight-writer' && namespace === 'KernelVision'
  })]));
  const refs = new Map();
  const transactions = new Map();
  const transport = { async request(id, envelope) {
    if (unavailable.has(id)) throw new Error('peer unavailable');
    return handlers.get(id)(envelope, { remotePeerId: 'weight-writer' });
  }};
  const store = new PeerContentAddressedStore({
    transport, peers, replicaCount: 2, minFailureDomains: 2,
    failureDomainsByPeerId: { 'weight-peer-a': 'domain-a', 'weight-peer-b': 'domain-b' },
    namespace: 'KernelVision', encryptionKey: Buffer.alloc(32, 19)
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
