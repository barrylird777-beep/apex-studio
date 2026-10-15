import test from 'node:test';
import assert from 'node:assert/strict';
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
