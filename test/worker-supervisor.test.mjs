import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerSupervisor } from '../src/core/mesh/worker-supervisor.mjs';

test('worker supervisor starts and executes queued work', async () => {
  const seen = [];
  const supervisor = new WorkerSupervisor({
    workers: 2,
    handler: async (payload, jobId) => {
      seen.push({ payload, jobId });
      return { ok: true, value: payload.value * 2 };
    }
  });

  assert.equal(supervisor.status().started, false);
  supervisor.start();
  assert.equal(supervisor.status().started, true);

  const result = await supervisor.dispatch({ value: 21 });
  assert.deepEqual(result, { ok: true, value: 42 });
  assert.equal(seen.length, 1);
  assert.ok(seen[0].jobId);

  const status = supervisor.status();
  assert.equal(status.pool.completed, 1);
  assert.equal(status.pool.failed, 0);
});

test('worker supervisor dispatch rejects before startup', async () => {
  const supervisor = new WorkerSupervisor({ handler: async () => ({ ok: true }) });
  assert.throws(() => supervisor.dispatch({}), /not running/i);
});
