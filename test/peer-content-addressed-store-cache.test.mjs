import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PeerContentAddressedStore } from '../src/core/peer-content-addressed-store.mjs';

function makeStore({ cacheTtlMs = 1000, cacheMaxBytes = 8 } = {}) {
  return new PeerContentAddressedStore({
    transport: { request: async () => { throw new Error('network must not be used by cache-only test'); } },
    peers: ['peer-test'], replicaCount: 1, minFailureDomains: 1,
    namespace: 'KernelVision', encryptionKey: Buffer.alloc(32, 7),
    cacheTtlMs, cacheMaxBytes, maxObjectBytes: 32 * 1024
  });
}

test('verified-object RAM cache returns defensive copies and records hot hits', () => {
  const store = makeStore();
  const original = Buffer.from('verified');
  const cid = 'a'.repeat(64);
  store.cacheSet(cid, original);
  original.fill(0);
  const cached = store.cacheGet(cid);
  assert.equal(cached.toString(), 'verified');
  cached.fill(0);
  assert.equal(store.cacheGet(cid).toString(), 'verified');
  assert.deepEqual(store.cacheSnapshot(), {
    hits: 2, misses: 0, evictions: 0, entries: 1, bytes: 8, ttlMs: 1000, maxBytes: 8
  });
});

test('RAM cache evicts least-recently-used entries to remain within its byte budget', () => {
  const store = makeStore({ cacheMaxBytes: 8 });
  store.cacheSet('a'.repeat(64), Buffer.from('1234'));
  store.cacheSet('b'.repeat(64), Buffer.from('5678'));
  assert.ok(store.cacheGet('a'.repeat(64)));
  store.cacheSet('c'.repeat(64), Buffer.from('abcd'));
  assert.equal(store.cacheGet('b'.repeat(64)), null);
  assert.ok(store.cacheGet('a'.repeat(64)));
  assert.ok(store.cacheGet('c'.repeat(64)));
  assert.equal(store.cacheSnapshot().bytes, 8);
  assert.equal(store.cacheSnapshot().entries, 2);
});

test('RAM cache expires entries and rejects objects larger than its configured budget', async () => {
  const store = makeStore({ cacheTtlMs: 10, cacheMaxBytes: 8 });
  store.cacheSet('a'.repeat(64), Buffer.from('too-large!'));
  assert.equal(store.cacheSnapshot().entries, 0);
  store.cacheSet('b'.repeat(64), Buffer.from('short'));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(store.cacheGet('b'.repeat(64)), null);
  assert.equal(store.cacheSnapshot().bytes, 0);
  assert.ok(store.cacheSnapshot().evictions >= 1);
});

function makeMemoryPeerStore() {
  const objects = new Map();
  const receiptFields = {
    durable: true, ownership: 'peer-owned', recoveryVerified: true,
    restartRecoveryVerified: true, atomicReferencesVerified: true,
    receipt: 'test-peer-durability-receipt', receiptId: 'receipt-test-1'
  };
  const transport = {
    async request(peerId, request) {
      if (request.operation === 'object.put') {
        const bytes = Buffer.from(request.bytesBase64, 'base64');
        const hash = createHash('sha256').update(bytes).digest('hex');
        if (hash !== request.hash) throw new Error('test peer rejected incorrect object CID');
        objects.set(hash, { bytes, namespace: request.namespace });
        return { peerId, accepted: true, hash, bytes: bytes.length, namespace: request.namespace, ...receiptFields };
      }
      if (request.operation === 'object.get') {
        const row = objects.get(request.hash);
        if (!row) throw new Error('test object unavailable');
        return { peerId, accepted: true, hash: request.hash, bytesBase64: row.bytes.toString('base64'),
          namespace: row.namespace, ...receiptFields };
      }
      throw new Error('unsupported test operation');
    }
  };
  return new PeerContentAddressedStore({
    transport, peers: ['peer-test'], replicaCount: 1, minFailureDomains: 1,
    namespace: 'KernelVision', encryptionKey: Buffer.alloc(32, 7),
    cacheTtlMs: 1000, cacheMaxBytes: 1024 * 1024, maxObjectBytes: 32 * 1024
  });
}

test('large assets use bounded hierarchical CID manifests and reconstruct with full integrity checks', async () => {
  const store = makeMemoryPeerStore();
  const input = Buffer.alloc(8 * 1024 * 65 + 19);
  for (let i = 0; i < input.length; i++) input[i] = (i * 17) % 251;
  const receipt = await store.putBlob(input);
  assert.equal(receipt.kind, 'apex.blob-manifest.v2');
  assert.ok(receipt.chunkCount > 64, 'test must cross the flat-manifest fanout threshold');
  const recovered = await store.getBlob(receipt.hash);
  assert.deepEqual(recovered, input);
  assert.equal(createHash('sha256').update(recovered).digest('hex'), receipt.contentSha256);
});

test('replica reconciliation repairs a missing CID from a verified peer source', async () => {
  const peerObjects = new Map([['peer-1', new Map()], ['peer-2', new Map()]]);
  const receiptFields = {
    durable: true, ownership: 'peer-owned', recoveryVerified: true,
    restartRecoveryVerified: true, atomicReferencesVerified: true,
    receipt: 'verified-test-receipt', receiptId: 'verified-test-receipt-id'
  };
  const transport = {
    async request(peerId, request) {
      const objects = peerObjects.get(peerId);
      if (request.operation === 'object.put') {
        const bytes = Buffer.from(request.bytesBase64, 'base64');
        const hash = createHash('sha256').update(bytes).digest('hex');
        if (hash !== request.hash) throw new Error('invalid CID');
        objects.set(hash, bytes);
        return { peerId, accepted: true, hash, bytes: bytes.length, namespace: request.namespace, ...receiptFields };
      }
      if (request.operation === 'object.get') {
        const bytes = objects.get(request.hash);
        if (!bytes) throw new Error('object missing');
        return { peerId, accepted: true, hash: request.hash, bytesBase64: bytes.toString('base64'),
          namespace: request.namespace, ...receiptFields };
      }
      throw new Error('unsupported operation');
    }
  };
  const store = new PeerContentAddressedStore({
    transport, peers: ['peer-1', 'peer-2'], replicaCount: 2, minFailureDomains: 2,
    failureDomainsByPeerId: { 'peer-1': 'hardware-root-a', 'peer-2': 'hardware-root-b' },
    namespace: 'KernelVision', encryptionKey: Buffer.alloc(32, 9), maxObjectBytes: 32 * 1024,
    cacheTtlMs: 0, cacheMaxBytes: 0
  });
  const saved = await store.putObject({ kind: 'repair-test', value: 'recover-me' });
  peerObjects.get('peer-2').delete(saved.hash);
  const repaired = await store.reconcileObject(saved.hash);
  assert.equal(repaired.verifiedReplicas, 2);
  assert.equal(repaired.failureDomains, 2);
  assert.ok(peerObjects.get('peer-2').has(saved.hash));
  assert.equal((await store.getObject(saved.hash)).value, 'recover-me');
});
