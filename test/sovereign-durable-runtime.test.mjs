import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import SovereignMeshEngine from '../src/core/sovereign-mesh-engine.mjs';
import { createDurableJobsStore } from '../src/jobs/durable-jobs-store.mjs';

test('concurrent sovereign dispatches serialize without duplicate waves', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-sovereign-concurrent-'));
  const previousPeer = process.env.APEX_SOVEREIGN_PEER_ID;
  process.env.APEX_SOVEREIGN_PEER_ID = 'test-peer';

  try {
    const engine = new SovereignMeshEngine(dir);
    await engine.ready();

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        engine.dispatchAutonomousPayload({
          waveId: `wave-${index}`,
          action: 'concurrent-test',
          payload: { index }
        })
      )
    );

    assert.equal(new Set(results.map((entry) => entry.seq)).size, 20);
    assert.equal(engine.size, 20);
  } finally {
    if (previousPeer === undefined) delete process.env.APEX_SOVEREIGN_PEER_ID;
    else process.env.APEX_SOVEREIGN_PEER_ID = previousPeer;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('partial WAL record fails closed during recovery', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-sovereign-partial-'));
  try {
    await fs.writeFile(
      path.join(dir, 'apex-ring-wal.ndjson'),
      '{"seq":1,"waveId":"partial"',
      'utf8'
    );

    const engine = new SovereignMeshEngine(dir);
    await assert.rejects(engine.ready(), /invalid JSON/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
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
