import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fetchChunksRarestFirst } from '../src/core/peer-rarest-first-fetch.mjs';

const cid = bytes => createHash('sha256').update(bytes).digest('hex');

test('rarest-first fetch verifies chunk hashes, receipts, expiry, and namespace', async () => {
  const a = Buffer.from('rare chunk');
  const b = Buffer.from('common chunk');
  const chunks = [{ hash: cid(a), bytes: a.length }, { hash: cid(b), bytes: b.length }];
  const now = 1000;
  const advertisements = [
    { peerId: 'peer-a', namespace: 'KernelVision', expiresAt: 2000, cids: [cid(a), cid(b)] },
    { peerId: 'peer-b', namespace: 'KernelVision', expiresAt: 2000, cids: [cid(b)] },
    { peerId: 'peer-expired', namespace: 'KernelVision', expiresAt: 999, cids: [cid(a)] },
    { peerId: 'peer-other-app', namespace: 'XShield', expiresAt: 2000, cids: [cid(a)] }
  ];
  const order = [];
  const result = await fetchChunksRarestFirst({
    chunks, advertisements, namespace: 'KernelVision', trustedPeerIds: ['peer-a', 'peer-b', 'peer-expired', 'peer-other-app'],
    verifyAdvertisement: async ad => ad.peerId !== 'peer-other-app',
    fetchChunk: async (peerId, hash) => {
      order.push(hash);
      return { bytes: hash === cid(a) ? a : b, namespace: 'KernelVision' };
    },
    verifyReplicaReceipt: async ({ peerId }) => peerId === 'peer-a' || peerId === 'peer-b',
    concurrency: 1, now
  });
  assert.equal(order[0], cid(a), 'the one-source chunk is requested before the two-source chunk');
  assert.deepEqual(result.chunks.get(cid(a)), a);
  assert.deepEqual(result.chunks.get(cid(b)), b);
  assert.equal(result.rarity[cid(a)], 1);
  assert.equal(result.rarity[cid(b)], 2);
});

test('rarest-first fetch fails closed when every peer returns corrupt bytes', async () => {
  const expected = Buffer.from('expected');
  const chunk = { hash: cid(expected), bytes: expected.length };
  await assert.rejects(fetchChunksRarestFirst({
    chunks: [chunk],
    advertisements: [{ peerId: 'peer-a', namespace: 'KernelVision', expiresAt: 5000, cids: [chunk.hash] }],
    namespace: 'KernelVision', trustedPeerIds: ['peer-a'],
    verifyAdvertisement: async () => true,
    fetchChunk: async () => Buffer.from('tampered'),
    verifyReplicaReceipt: async () => true,
    now: 1000
  }), error => error.code === 'OBJECT_UNAVAILABLE');
});
