import test from 'node:test';
import assert from 'node:assert/strict';
import SovereignMeshEngine from '../src/core/sovereign-mesh-engine.mjs';
import { createDurableJobsStore } from '../src/jobs/durable-jobs-store.mjs';
import { MemoryMeshCAS } from './helpers/memory-mesh-cas.mjs';

test('concurrent peer-CAS dispatches serialize without duplicate waves', async () => {
  const previousPeer = process.env.APEX_SOVEREIGN_PEER_ID;
  process.env.APEX_SOVEREIGN_PEER_ID = 'test-peer';
  try {
    const engine = new SovereignMeshEngine({ cas: new MemoryMeshCAS() });
    await engine.ready();
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) =>
      engine.dispatchAutonomousPayload({
        waveId: `wave-${index}`, action: 'concurrent-test', payload: { index }
      })
    ));
    assert.equal(new Set(results.map(entry => entry.seq)).size, 20);
    assert.equal(engine.size, 20);
  } finally {
    if (previousPeer === undefined) delete process.env.APEX_SOVEREIGN_PEER_ID;
    else process.env.APEX_SOVEREIGN_PEER_ID = previousPeer;
  }
});

test('mesh engine fails closed instead of reading a legacy WAL path', async () => {
  assert.throws(() => new SovereignMeshEngine('/tmp/legacy-path'), /peer-backed CAS; local fallback is forbidden/);
});

test('durable store claim SQL enforces SKIP LOCKED and monotonic fencing', async () => {
  const queries = [];
  const db = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes('UPDATE durable_jobs')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [] };
    }
  };

  const store = createDurableJobsStore(db);
  await store.claimOne({
    workerId: 'worker-test',
    now: new Date(),
    leaseMs: 60000
  });

  const claimSql = queries.at(-1);
  assert.match(claimSql, /FOR UPDATE SKIP LOCKED/);
  assert.match(claimSql, /lease_fence = j\.lease_fence \+ 1/);
  assert.match(claimSql, /lease_token = \$3::uuid/);
});

