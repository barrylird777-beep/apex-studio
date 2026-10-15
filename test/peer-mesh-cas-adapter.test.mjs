import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PeerMeshCasAdapter } from '../src/core/peer-mesh-cas-adapter.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function fakePeerCas() {
  const refs = new Map();
  return {
    namespace: 'KernelVision',
    replicaCount: 2,
    async listRefs() { return [...refs.values()].map(row => structuredClone(row)); },
    async readRef(key) { return refs.has(key) ? structuredClone(refs.get(key)) : null; },
    async writeRef(key, value, { expectedHash = null } = {}) {
      const current = refs.get(key);
      if ((current?.hash ?? null) !== expectedHash) {
        const error = new Error('CAS conflict'); error.code = 'CAS_CONFLICT'; throw error;
      }
      const hash = digest(value);
      refs.set(key, { namespace: 'KernelVision', key, value: structuredClone(value), hash });
      return { hash };
    },
    async putObject(value) {
      const hash = digest(value);
      return { hash, namespace: 'KernelVision', receipts: [
        { peerId: 'peer-a', hash, namespace: 'KernelVision' },
        { peerId: 'peer-b', hash, namespace: 'KernelVision' }
      ] };
    },
    async getObject() { throw new Error('not used in this test'); }
  };
}

test('peer job queue refreshes shared state and reclaims expired leases with fencing', async () => {
  const raw = fakePeerCas();
  const workerA = new PeerMeshCasAdapter({ store: raw, appNamespace: 'KernelVision' });
  const workerB = new PeerMeshCasAdapter({ store: raw, appNamespace: 'KernelVision' });
  await workerA.enqueue({ id: 'recoverable-job', type: 'test.task', runAt: Date.now() - 1, maxAttempts: 3 });

  const [first] = await workerA.claim({ workerId: 'worker-a', leaseMs: 30000 });
  assert.ok(first);
  assert.equal(first.leaseFence, 1);
  assert.equal(first.attempts, 1);

  const refKey = 'jobs/recoverable-job';
  const current = await raw.readRef(refKey);
  const expired = { ...current.value.job, leaseExpiresAt: Date.now() - 1 };
  await raw.writeRef(refKey, { id: expired.id, job: expired }, { expectedHash: current.hash });

  const [recovered] = await workerB.claim({ workerId: 'worker-b', leaseMs: 30000 });
  assert.ok(recovered);
  assert.equal(recovered.leaseOwner, 'worker-b');
  assert.notEqual(recovered.leaseToken, first.leaseToken);
  assert.equal(recovered.leaseFence, first.leaseFence + 1);
  assert.equal(recovered.attempts, 2);
  assert.equal(recovered.recoveredCount, 1);

  assert.equal(await workerA.transition('recoverable-job', 'complete', {
    leaseToken: first.leaseToken, leaseFence: first.leaseFence, result: { stale: true }
  }), false, 'the expired worker must be fenced out after recovery');
});
