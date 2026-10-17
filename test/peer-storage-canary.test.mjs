import test from 'node:test';
import assert from 'node:assert/strict';
import { createKernelVisionPeerStorageCanary } from '../src/core/peer-storage-canary.mjs';

test('KernelVision peer canary is disabled by default and never falls back locally', async () => {
  const canary = createKernelVisionPeerStorageCanary({ store: null });
  assert.equal(canary.enabled, false);
  await assert.rejects(canary.write('draft-1', { title: 'test' }), /disabled/);
  await assert.rejects(canary.read('draft-1'), /disabled/);
});

test('KernelVision canary routes scoped writes and reads through peer CAS references', async () => {
  const refs = new Map();
  const calls = [];
  const store = {
    namespace: 'KernelVision',
    async readRef(key) {
      calls.push(['read', key]);
      return refs.has(key) ? { value: refs.get(key).value, hash: refs.get(key).hash } : null;
    },
    async writeRef(key, value, { expectedHash }) {
      calls.push(['write', key]);
      const current = refs.get(key);
      assert.equal(current?.hash ?? null, expectedHash);
      const hash = String(refs.size + 1).padStart(64, '0');
      refs.set(key, { value, hash });
      return { hash, replicas: ['peer-a', 'peer-b'], receipts: [{ peerId: 'peer-a' }, { peerId: 'peer-b' }] };
    }
  };
  const canary = createKernelVisionPeerStorageCanary({ store, enabled: true });
  const saved = await canary.write('draft-1', { title: 'unpublished' });
  assert.equal(saved.replicas.length, 2);
  assert.deepEqual((await canary.read('draft-1')).value, { title: 'unpublished' });
  assert.equal(calls.some(([operation, key]) => operation === 'write' && key === 'canary-v1:draft-1'), true);
  await assert.rejects(canary.write('../legacy'), /safe characters/);
});

test('KernelVision canary refuses a store for another app namespace', () => {
  assert.throws(() => createKernelVisionPeerStorageCanary({
    enabled: true,
    store: { namespace: 'PlanetApeX', readRef() {}, writeRef() {} }
  }), /KernelVision namespace/);
});
