import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import crypto from "node:crypto";
import {
  ensureWorkerTaskSchema,
  enqueueWorkerTask,
  claimNextWorkerTasks,
  claimWorkerTask,
  completeWorkerTask,
  requeueExpiredWorkerTasks,
  closeWorkerStore,
  claimExternalEffect,
  completeExternalEffect,
  releaseWorkerTasks,
  acquireAiRateLimit
} from "../src/core/mesh/durable-worker-store.mjs";

const hasDatabase = Boolean(String(process.env.DATABASE_URL || "").trim());

test("two workers race for one task and only one claim wins", { skip: !hasDatabase, concurrency: false }, async () => {
  const id = crypto.randomUUID();
  await ensureWorkerTaskSchema();
  await enqueueWorkerTask({ id, workerId: "race-test", role: "general", task: "race" });

  const [a, b] = await Promise.all([
    claimWorkerTask(id, 15000),
    claimWorkerTask(id, 15000)
  ]);
  const claimed = [a, b].filter(Boolean);
  assert.equal(claimed.length, 1);

  assert.equal(await completeWorkerTask(id, { ok: true }, claimed[0].lease_token), true);
});

test("expired lease can be reclaimed but stale result is rejected", { skip: !hasDatabase }, async () => {
  const id = crypto.randomUUID();
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await ensureWorkerTaskSchema();
    await enqueueWorkerTask({ id, workerId: "crash-test", role: "general", task: "crash", maxAttempts: 3 });

    const first = await claimWorkerTask(id, 15000);
    assert.equal(first.id, id);

    await db.query(
      "UPDATE apex_worker_tasks SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",
      [id]
    );
    assert.equal(await requeueExpiredWorkerTasks(), 1);
    await db.query("UPDATE apex_worker_tasks SET next_run_at=NOW() WHERE id=$1", [id]);

    const second = await claimWorkerTask(id, 15000);
    assert.ok(second);
    assert.equal(second.id, id);
    assert.notEqual(second.lease_token, first.lease_token);

    assert.equal(await completeWorkerTask(id, { stale: true }, first.lease_token), false);
    assert.equal(await completeWorkerTask(id, { ok: true }, second.lease_token), true);
  } finally {
    await db.query("DELETE FROM apex_worker_tasks WHERE id=$1", [id]).catch(() => {});
    await db.end();
  }
});

test("expired recovery workers partition rows with SKIP LOCKED", { skip: !hasDatabase }, async () => {
  const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await ensureWorkerTaskSchema();
    for (const id of ids) {
      await enqueueWorkerTask({ id, workerId: "recovery-race", role: "general", task: "recovery", maxAttempts: 3 });
      await claimWorkerTask(id, 15000);
    }
    await db.query(
      "UPDATE apex_worker_tasks SET lease_expires_at=NOW()-INTERVAL '1 second', next_run_at=NULL WHERE id=ANY($1::uuid[])",
      [ids]
    );
    const [a, b] = await Promise.all([
      requeueExpiredWorkerTasks(2),
      requeueExpiredWorkerTasks(2)
    ]);
    assert.equal(a + b, ids.length);
    const rows = await db.query("SELECT recovered_count FROM apex_worker_tasks WHERE id=ANY($1::uuid[])", [ids]);
    assert.deepEqual(rows.rows.map(r => r.recovered_count).sort((x, y) => x - y), [1, 1, 1, 1]);
  } finally {
    await db.query("DELETE FROM apex_worker_tasks WHERE id=ANY($1::uuid[])", [ids]).catch(() => {});
    await db.end();
  }
});

test("lease heartbeat extends the active fence", { skip: !hasDatabase }, async () => {
  const id = crypto.randomUUID();
  await ensureWorkerTaskSchema();
  await enqueueWorkerTask({ id, workerId: "heartbeat-test", role: "general", task: "heartbeat" });
  const task = await claimWorkerTask(id, 15000);
  assert.ok(task?.lease_token);
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const before = await db.query("SELECT lease_expires_at FROM apex_worker_tasks WHERE id=$1", [id]);
    assert.equal(await (await import("../src/core/mesh/durable-worker-store.mjs")).heartbeatWorkerTask(id, 30000, task.lease_token), true);
    const after = await db.query("SELECT lease_expires_at FROM apex_worker_tasks WHERE id=$1", [id]);
    assert.ok(new Date(after.rows[0].lease_expires_at) > new Date(before.rows[0].lease_expires_at));
  } finally {
    await db.query("DELETE FROM apex_worker_tasks WHERE id=$1", [id]).catch(() => {});
    await db.end();
    await closeWorkerStore();
  }
});

test("external side effect idempotency key admits only one caller", { skip: !hasDatabase }, async () => {
  const key = "race-effect-" + crypto.randomUUID();
  await ensureWorkerTaskSchema();
  const [a, b] = await Promise.all([claimExternalEffect(key), claimExternalEffect(key)]);
  assert.equal([a, b].filter(Boolean).length, 1);
  assert.equal(await completeExternalEffect(key, { ok: true }), true);
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try { await db.query("DELETE FROM apex_external_effects WHERE idempotency_key=$1", [key]); }
  finally { await db.end(); await closeWorkerStore(); }
});

test("shutdown release pairs each task with its exact lease token", { skip: !hasDatabase }, async () => {
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  await ensureWorkerTaskSchema();
  for (const id of ids) {
    await enqueueWorkerTask({ id, workerId: "release-test", role: "general", task: "release" });
  }
  const tasks = await claimNextWorkerTasks(2, 15000);
  assert.equal(tasks.length, 2);
  const tokens = tasks.map(task => task.lease_token);
  assert.equal(await releaseWorkerTasks(ids, [tokens[1], tokens[0]]), 0);
  assert.equal(await releaseWorkerTasks(ids, tokens), 2);
  await closeWorkerStore();
});

test("rate limiter has a bounded wait instead of looping forever", { skip: !hasDatabase }, async () => {
  const key = "rate-limit-test-" + crypto.randomUUID();
  await ensureWorkerTaskSchema();
  try {
    assert.equal(await acquireAiRateLimit({ key, capacity: 1, refillPerSecond: 0.0001, maxWaitMs: 100 }), true);
    assert.equal(await acquireAiRateLimit({ key, capacity: 1, refillPerSecond: 0.0001, retryMs: 50, maxWaitMs: 100 }), false);
  } finally {
    const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try { await db.query("DELETE FROM rate_limits WHERE key=$1", [key]); }
    finally { await db.end(); await closeWorkerStore(); }
  }
});

test("durable worker store keeps heartbeat and external-effect operations fenceable", () => {
  const source = fs.readFileSync(new URL("../src/core/mesh/durable-worker-store.mjs", import.meta.url), "utf8");
  assert.match(source, /export async function heartbeatWorkerTasks/);
  assert.match(source, /unnest\(\$1::uuid\[\], \$2::text\[\]\)/);
  assert.match(source, /export async function releaseExternalEffect/);
  assert.match(source, /status='started'/);
  assert.match(source, /lease_expires_at/);
  assert.match(source, /apex_external_effects\.status='started'/);
});
