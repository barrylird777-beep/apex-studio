import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import SovereignMeshEngine from '../src/core/sovereign-mesh-engine.mjs';
import { createDurableJobsStore } from '../src/jobs/durable-jobs-store.mjs';
import { createSovereignDurableBridge } from '../src/core/sovereign-durable-bridge.mjs';

function sqlDb(rows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('INSERT INTO durable_jobs')) return { rows: rows.splice(0, 1), rowCount: rows.length ? 1 : 0 };
      if (sql.includes('SELECT id, status')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    }
  };
}

test('claiming uses row locks and monotonic fencing', async () => {
  const calls = [];
  const db = { async query(sql) { calls.push(sql); return { rows: [], rowCount: 0 }; } };
  const store = createDurableJobsStore(db);
  await store.claimOne({ workerId: 'w1', now: new Date(), leaseMs: 30000 });
  const sql = calls.at(-1);
  assert.match(sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(sql, /lease_fence = j\.lease_fence \+ 1/);
  assert.match(sql, /lease_token = \$3::uuid/);
});

test('concurrent claims remain disjoint by SQL contract', async () => {
  const calls = [];
  const db = { async query(sql) {
    calls.push(sql);
    return { rows: [], rowCount: 0 };
  }};
  const store = createDurableJobsStore(db);
  await Promise.all(Array.from({length: 32}, (_, i) =>
    store.claimBatch({ workerId: `w-${i}`, now: new Date(), leaseMs: 30000, batchSize: 20 })
  ));
  assert.equal(calls.length, 32);
  assert.ok(calls.every(sql => /FOR UPDATE SKIP LOCKED/.test(sql)));
});

test('WAL replay persists dispatched records and only acknowledges after durable acceptance', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-wal-replay-'));
  const previous = process.env.APEX_SOVEREIGN_PEER_ID;
  process.env.APEX_SOVEREIGN_PEER_ID = 'replay-peer';
  const db = {
    calls: [],
    async query(sql, params) {
      this.calls.push({ sql, params });
      if (sql.includes('INSERT INTO durable_jobs')) return { rows: [{ id: randomUUID(), status: 'queued', attempts: 0, max_attempts: 8, dedupe_key: 'sovereign:test', lease_fence: 0 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }
  };
  try {
    const engine1 = new SovereignMeshEngine(dir);
    await engine1.ready();
    const record = await engine1.dispatchAutonomousPayload({ waveId: 'replay-wave', action: 'render.dispatch', payload: { resolution: 1440 } });
    const bridge = createSovereignDurableBridge({
      engine: engine1, db, workerId: 'replay-worker',
      peerNode: {}, peerAddress: '/ip4/127.0.0.1/tcp/1/p2p/test',
      sendPeer: async () => ({ accepted: true })
    });
    const result = await bridge.reconcile();
    assert.equal(result.scanned, 1);
    assert.equal(result.failed, 0);
    assert.equal(result.acknowledged, 1);
    assert.equal(engine1.get(record.waveId).status, 'ACKNOWLEDGED');

    const engine2 = new SovereignMeshEngine(dir);
    await engine2.ready();
    assert.equal(engine2.get(record.waveId).status, 'ACKNOWLEDGED');
  } finally {
    if (previous === undefined) delete process.env.APEX_SOVEREIGN_PEER_ID;
    else process.env.APEX_SOVEREIGN_PEER_ID = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('malformed WAL fails closed', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-wal-bad-'));
  try {
    await fs.writeFile(path.join(dir, 'apex-ring-wal.ndjson'), '{"seq":1,"waveId":"broken"\n');
    const engine = new SovereignMeshEngine(dir);
    await assert.rejects(engine.ready(), /invalid JSON/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('stale lease completion is rejected by fencing contract', async () => {
  const calls = [];
  const db = { async query(sql) {
    calls.push(sql);
    return { rows: [], rowCount: 0 };
  }};
  const store = createDurableJobsStore(db);
  const ok = await store.complete({
    id: randomUUID(), token: randomUUID(), fence: 1, result: { ok: true }, now: new Date()
  });
  assert.equal(ok, false);
  assert.match(calls[0], /lease_token = \$2::uuid/);
  assert.match(calls[0], /lease_fence = \$3/);
  assert.match(calls[0], /lease_expires_at > \$5/);
});

test('crash recovery requeues expired work and advances recovery accounting', async () => {
  const db = { async query(sql) {
    assert.match(sql, /FOR UPDATE SKIP LOCKED/);
    assert.match(sql, /recovered_count = j\.recovered_count \+ 1/);
    return { rows: [{ id: randomUUID(), status: 'queued', recovered_count: 1 }], rowCount: 1 };
  }};
  const store = createDurableJobsStore(db);
  const rows = await store.recoverExpired({ now: new Date(), runAt: new Date(), errorFor: 'simulated crash' });
  assert.equal(rows.length, 1);
});

test('dispatch load produces unique WAL waves', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-wal-load-'));
  const previous = process.env.APEX_SOVEREIGN_PEER_ID;
  process.env.APEX_SOVEREIGN_PEER_ID = 'load-peer';
  try {
    const engine = new SovereignMeshEngine(dir);
    await engine.ready();
    const n = 100;
    const results = await Promise.all(Array.from({length:n}, (_, i) =>
      engine.dispatchAutonomousPayload({ waveId: `load-${i}`, action:'load.test', payload:{i} })
    ));
    assert.equal(results.length, n);
    assert.equal(new Set(results.map(x => x.waveId)).size, n);
    assert.equal(new Set(results.map(x => x.seq)).size, n);
  } finally {
    if (previous === undefined) delete process.env.APEX_SOVEREIGN_PEER_ID;
    else process.env.APEX_SOVEREIGN_PEER_ID = previous;
    await fs.rm(dir, { recursive:true, force:true });
  }
});
