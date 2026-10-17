import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { evaluateAccessTensor, normalizeAccessTensor, publishAccessTensor, loadAccessTensor } from '../src/core/namespace-access-tensor.mjs';

const now = 1_800_000_000_000;
const tensor = (overrides = {}) => ({
  kind: 'apex.access-tensor.v1', namespace: 'KernelVision', version: 1,
  issuedAt: now - 1000, expiresAt: now + 60_000, previousCid: null,
  rules: [{ subject: 'studio-api', resource: 'assets', actions: ['read', 'write'], effect: 'allow' }],
  ...overrides
});

function fixture() {
  const objects = new Map(), refs = new Map();
  const store = {
    namespace: 'KernelVision', replicaCount: 2,
    async putObject(value) {
      const hash = createHash('sha256').update(JSON.stringify(value)).digest('hex');
      objects.set(hash, structuredClone(value));
      return { hash, namespace: this.namespace, receipts: [{}, {}] };
    },
    async getObject(hash) { if (!objects.has(hash)) throw new Error('missing object'); return structuredClone(objects.get(hash)); }
  };
  const cas = {
    namespace: 'KernelVision',
    async readRef(ns, key) { return refs.get(ns + '/' + key) || null; },
    async writeRef(ns, key, value, { expectedHash = null } = {}) {
      const id = ns + '/' + key, current = refs.get(id);
      if ((current?.hash ?? null) !== expectedHash) { const error = new Error('CAS conflict'); error.code = 'CAS_CONFLICT'; throw error; }
      const hash = createHash('sha256').update(JSON.stringify(value)).digest('hex');
      const ref = { namespace: ns, key, value: structuredClone(value), hash };
      refs.set(id, ref); return ref;
    }
  };
  return { store, cas };
}

test('access tensor normalizes stable scopes and rejects expired or malformed policy', () => {
  const policy = normalizeAccessTensor(tensor(), { now });
  assert.equal(policy.namespace, 'KernelVision');
  assert.equal(evaluateAccessTensor(policy, { namespace: 'KernelVision', subject: 'studio-api', resource: 'assets/video/1', action: 'read', now }), true);
  assert.equal(evaluateAccessTensor(policy, { namespace: 'XShield', subject: 'studio-api', resource: 'assets/video/1', action: 'read', now }), false);
  assert.equal(evaluateAccessTensor(policy, { namespace: 'KernelVision', subject: 'intruder', resource: 'assets/video/1', action: 'read', now }), false);
  assert.equal(evaluateAccessTensor(policy, { namespace: 'KernelVision', subject: 'studio-api', resource: 'assets2', action: 'read', now }), false);
  assert.throws(() => normalizeAccessTensor(tensor({ expiresAt: now - 1 }), { now }));
});

test('explicit deny overrides a matching allow rule', () => {
  const policy = tensor({ rules: [
    { subject: '*', resource: 'assets', actions: ['read'], effect: 'allow' },
    { subject: 'studio-api', resource: 'assets/private', actions: ['read'], effect: 'deny' }
  ] });
  assert.equal(evaluateAccessTensor(policy, { namespace: 'KernelVision', subject: 'studio-api', resource: 'assets/private/item', action: 'read', now }), false);
});

test('publishes versioned policy CID before atomically swapping the active pointer', async () => {
  const { store, cas } = fixture();
  const first = await publishAccessTensor({ store, cas, tensor: tensor(), expectedPointerHash: null, now });
  assert.match(first.cid, /^[a-f0-9]{64}$/);
  const loaded = await loadAccessTensor({ store, cas, namespace: 'KernelVision', now });
  assert.equal(loaded.cid, first.cid);
  assert.equal(loaded.tensor.version, 1);
  await assert.rejects(publishAccessTensor({ store, cas, tensor: tensor({ version: 2, previousCid: first.cid }), expectedPointerHash: null, now }),
    error => error.code === 'CAS_CONFLICT');
});

test('version 2 must point to the active version-1 CID', async () => {
  const { store, cas } = fixture();
  const first = await publishAccessTensor({ store, cas, tensor: tensor(), expectedPointerHash: null, now });
  const current = await cas.readRef('access-tensors', 'active');
  const secondTensor = tensor({ version: 2, previousCid: first.cid, issuedAt: now, expiresAt: now + 90_000 });
  const second = await publishAccessTensor({ store, cas, tensor: secondTensor, expectedPointerHash: current.hash, now });
  assert.equal(second.version, 2);
  assert.equal((await loadAccessTensor({ store, cas, namespace: 'KernelVision', now })).cid, second.cid);
});

test('app namespace mismatch cannot publish or load a policy', async () => {
  const { store, cas } = fixture();
  await assert.rejects(publishAccessTensor({ store, cas, tensor: tensor({ namespace: 'XShield' }), expectedPointerHash: null, now }));
  await assert.rejects(loadAccessTensor({ store, cas, namespace: 'XShield', now }));
});
