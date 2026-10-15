import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign as signBytes } from 'node:crypto';
import { encodeCanonical } from '../src/core/apex-cbor.mjs';
import { PeerContentAddressedStore } from '../src/core/peer-content-addressed-store.mjs';
import { initializePeerObjectStorage } from '../src/core/peer-storage-runtime.mjs';

const receiptPair = generateKeyPairSync('ed25519');
const receiptPublicKey = receiptPair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
function signedReceipt({ namespace, peerId, operation = 'storage.health', objectHash = null, key = null, pair = receiptPair }) {
  const claims = { version: 1, peerId, namespace, operation, objectHash, key, ownership: 'peer-owned', durable: true, atomicReferencesVerified: true, restartRecoveryVerified: true };
  const body = encodeCanonical(claims);
  return { ...claims, receipt: { algorithm: 'Ed25519', body: body.toString('base64'), signature: signBytes(null, body, pair.privateKey).toString('base64') }, receiptId: createHash('sha256').update(body).digest('hex') };
}

function binaryMemoryStore() {
  const objects = new Map();
  return {
    objects,
    async putBytes(hash, input) {
      const bytes = Buffer.from(input);
      if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('hash mismatch');
      objects.set(hash, Buffer.from(bytes));
      return { hash, bytes: bytes.length };
    },
    async getBytes(hash) {
      if (!objects.has(hash)) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      return Buffer.from(objects.get(hash));
    }
  };
}

test('peer object storage stays disabled unless explicitly enabled', async () => {
  const runtime = await initializePeerObjectStorage({ enabled: false });
  assert.equal(runtime.enabled, false);
  await assert.rejects(runtime.handle({}, { remotePeerId: 'writer-peer' }), /disabled/);
});

test('peer object storage requires an injected binary backend and canonical explicit namespace ACL', async () => {
  await assert.rejects(
    initializePeerObjectStorage({ enabled: true, namespaceAcl: 'PlanetApeX=writer-peer', peerId: () => 'storage-peer' }),
    /injected peer-owned binary backend/
  );
  await assert.rejects(
    initializePeerObjectStorage({ enabled: true, store: binaryMemoryStore(), namespaceAcl: 'KoBlocks=writer-peer', peerId: () => 'storage-peer' }),
    /non-canonical app/
  );
  await assert.rejects(
    initializePeerObjectStorage({ enabled: true, store: binaryMemoryStore(), namespaceAcl: '', peerId: () => 'storage-peer' }),
    /ACL is empty/
  );
});

test('opt-in runtime stores encrypted bytes through an injected backend and enforces namespace ACL', async () => {
  const store = binaryMemoryStore();
  const refs = new Map();
  store.readRef = async (namespace, key) => refs.get(namespace + ':' + key) ?? null;
  store.writeRef = async (namespace, key, expectedHash, hash, bytes) => {
    const refKey = namespace + ':' + key;
    if ((refs.get(refKey)?.hash ?? null) !== expectedHash) throw new Error('reference compare-and-swap conflict');
    refs.set(refKey, { hash, bytes: Buffer.from(bytes) });
    return { hash };
  };
  store.listRefs = async namespace => [...refs.entries()]
    .filter(([refKey]) => refKey.startsWith(namespace + ':'))
    .map(([refKey, ref]) => ({ key: refKey.slice(namespace.length + 1), hash: ref.hash, bytes: Buffer.from(ref.bytes) }));
  store.health = async ({ namespace, peerId, operation, objectHash = null, key = null }) => ({
    durable: true, ownership: 'peer-owned', restartRecoveryVerified: true,
    atomicReferencesVerified: true, peerId, namespace, ...signedReceipt({ namespace, peerId, operation, objectHash, key })
  });
  store.verifyDurabilityReceipt = async (receipt, claims) => {
    if (receipt?.algorithm !== 'Ed25519' || claims.peerId !== 'storage-peer' ||
        claims.namespace !== 'PlanetApeX' || claims.restartRecoveryVerified !== true ||
        claims.atomicReferencesVerified !== true) return false;
    try {
      const body = Buffer.from(receipt.body, 'base64');
      const signed = (await import('../src/core/apex-cbor.mjs')).decodeCanonical(body);
      return body.toString('base64') === receipt.body &&
        signed.peerId === claims.peerId && signed.namespace === claims.namespace &&
        signed.operation === claims.operation && signed.objectHash === claims.objectHash && signed.key === claims.key;
    } catch { return false; }
  };
  const runtime = await initializePeerObjectStorage({
    enabled: true,
    store,
    namespaceAcl: 'PlanetApeX=writer-peer',
    peerId: () => 'storage-peer'
  });
  const client = new PeerContentAddressedStore({
    transport: { request: async (_peerId, envelope) => runtime.handle(envelope, { remotePeerId: 'writer-peer' }) },
    peers: ['storage-peer'],
    replicaCount: 1,
    failureDomainsByPeerId: { 'storage-peer': 'test-domain-storage-peer' },
    namespace: 'PlanetApeX',
    encryptionKey: Buffer.alloc(32, 23),
    receiptPublicKeysByPeerId: { 'storage-peer': receiptPublicKey }
  });
  const value = { privateTitle: 'unpublished manuscript', app: 'PlanetApeX' };
  const receipt = await client.putObject(value);
  assert.equal(receipt.replicas[0], 'storage-peer');
  assert.deepEqual(await client.getObject(receipt.hash), value);
  const referenceValue = { objectHash: receipt.hash, revision: 1 };
  const reference = await client.writeRef('library-main', referenceValue, { expectedHash: null });
  assert.equal(reference.hash.length, 64);
  assert.deepEqual(await client.listRefs(), [
    { namespace: 'PlanetApeX', key: 'library-main', hash: reference.hash, value: referenceValue }
  ]);
  const storedBytes = store.objects.get(receipt.hash);
  assert.equal(Buffer.isBuffer(storedBytes), true);
  assert.equal(storedBytes.includes(Buffer.from('unpublished manuscript')), false);
  await assert.rejects(
    runtime.handle({ protocol: 'apex.cas.v1', operation: 'object.get', namespace: 'PlanetApeX', hash: receipt.hash }, { remotePeerId: 'unlisted-peer' }),
    /namespace access denied/
  );
});


test('six-app namespace ACL allows only each app’s explicitly listed peer', async () => {
  const apps = ['KernelVision', 'XShield', 'Kernelodies', 'PlanetApeX', 'KashKorner', 'KoinKob'];
  const acl = apps.map((app, index) => app + '=writer-' + index).join(';');
  const store = binaryMemoryStore();
  store.readRef = async () => null;
  store.writeRef = async () => { throw new Error('not used by health ACL test'); };
  store.health = async ({ namespace, peerId, operation = 'storage.health', objectHash = null, key = null }) => ({
    durable: true, ownership: 'peer-owned', restartRecoveryVerified: true,
    atomicReferencesVerified: true, ...signedReceipt({ namespace, peerId, operation, objectHash, key })
  });
  store.verifyDurabilityReceipt = async (receipt, claims) => {
    if (receipt?.algorithm !== 'Ed25519' || claims.peerId !== 'storage-peer' ||
        claims.restartRecoveryVerified !== true || claims.atomicReferencesVerified !== true) return false;
    try {
      const body = Buffer.from(receipt.body, 'base64');
      const { decodeCanonical } = await import('../src/core/apex-cbor.mjs');
      const signed = decodeCanonical(body);
      return body.toString('base64') === receipt.body &&
        signed.peerId === claims.peerId && signed.namespace === claims.namespace &&
        signed.operation === claims.operation && signed.objectHash === claims.objectHash && signed.key === claims.key;
    } catch { return false; }
  };
  const runtime = await initializePeerObjectStorage({
    enabled: true, store, namespaceAcl: acl, peerId: () => 'storage-peer'
  });

  for (let i = 0; i < apps.length; i += 1) {
    for (let j = 0; j < apps.length; j += 1) {
      const request = {
        protocol: 'apex.cas.v1',
        operation: 'storage.health',
        namespace: apps[i]
      };
      if (i === j) {
        const result = await runtime.handle(request, { remotePeerId: 'writer-' + j });
        assert.equal(result.accepted, true, apps[i] + ' should accept its assigned peer');
        assert.equal(result.namespace, apps[i]);
      } else {
        await assert.rejects(
          runtime.handle(request, { remotePeerId: 'writer-' + j }),
          /namespace access denied/,
          apps[j] + ' must not access ' + apps[i]
        );
      }
    }
  }
});


test('writer rejects forged, cross-peer, altered-hash, and altered-namespace durability receipts', async () => {
  const otherPair = generateKeyPairSync('ed25519');
  const publicKeys = { 'storage-peer': receiptPublicKey };
  const value = { object: 'receipt-negative-test' };
  const variants = [
    ['forged signature', ({ receipt }) => ({ ...receipt, signature: Buffer.alloc(64, 1).toString('base64') })],
    ['another peer signature', ({ namespace, peerId, operation, objectHash, key }) => signedReceipt({ namespace, peerId, operation, objectHash, key, pair: otherPair }).receipt],
    ['altered object hash', ({ namespace, peerId, operation, key }) => signedReceipt({ namespace, peerId, operation, objectHash: '0'.repeat(64), key }).receipt],
    ['altered namespace', ({ peerId, operation, objectHash, key }) => signedReceipt({ namespace: 'XShield', peerId, operation, objectHash, key }).receipt]
  ];
  for (const [name, mutate] of variants) {
    const transport = {
      async request(peerId, request) {
        const signed = signedReceipt({
          namespace: request.namespace, peerId, operation: request.operation,
          objectHash: request.hash ?? null, key: request.key ?? null
        });
        const receipt = mutate({ ...request, peerId, ...signed.claims, receipt: signed.receipt });
        return {
          accepted: true, peerId, namespace: request.namespace, hash: request.hash,
          bytes: Buffer.from(request.bytesBase64, 'base64').length,
          durable: true, ownership: 'peer-owned', recoveryVerified: true,
          restartRecoveryVerified: true, atomicReferencesVerified: true,
          receipt, receiptId: signed.receiptId
        };
      }
    };
    const client = new PeerContentAddressedStore({
      transport, peers: ['storage-peer'], replicaCount: 1,
      failureDomainsByPeerId: { 'storage-peer': 'test-domain' },
      namespace: 'PlanetApeX', encryptionKey: Buffer.alloc(32, 29),
      receiptPublicKeysByPeerId: publicKeys
    });
    await assert.rejects(client.putObject(value), error =>
      error.code === 'INSUFFICIENT_REPLICAS' && error.verifiedReplicas === 0,
      name + ' must not count as a durable replica'
    );
  }
});
