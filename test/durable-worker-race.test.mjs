import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import crypto from "node:crypto";
import {
  ensureWorkerTaskSchema,
  enqueueWorkerTask,
  claimNextWorkerTasks,
  completeWorkerTask,
  requeueExpiredWorkerTasks,
  closeWorkerStore
} from "../src/core/mesh/durable-worker-store.mjs";

const hasDatabase = Boolean(String(process.env.DATABASE_URL || "").trim());

test("two workers race for one task and only one claim wins", { skip: !hasDatabase }, async () => {
  const id = crypto.randomUUID();
  await ensureWorkerTaskSchema();
  await enqueueWorkerTask({ id, workerId: "race-test", role: "general", task: "race" });

  const [a, b] = await Promise.all([
    claimNextWorkerTasks(1, 15000),
    claimNextWorkerTasks(1, 15000)
  ]);
  const claimed = [...a, ...b].filter(task => task.id === id);
  assert.equal(claimed.length, 1);

  assert.equal(await completeWorkerTask(id, { ok: true }, claimed[0].lease_token), true);
  await closeWorkerStore();
});

test("expired lease can be reclaimed but stale result is rejected", { skip: !hasDatabase }, async () => {
  const id = crypto.randomUUID();
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await ensureWorkerTaskSchema();
    await enqueueWorkerTask({ id, workerId: "crash-test", role: "general", task: "crash", maxAttempts: 3 });

    const [first] = await claimNextWorkerTasks(1, 15000);
    assert.equal(first.id, id);

    await db.query(
      "UPDATE apex_worker_tasks SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",
      [id]
    );
    assert.equal(await requeueExpiredWorkerTasks(), 1);

    const [second] = await claimNextWorkerTasks(1, 15000);
    assert.equal(second.id, id);
    assert.notEqual(second.lease_token, first.lease_token);

    assert.equal(await completeWorkerTask(id, { stale: true }, first.lease_token), false);
    assert.equal(await completeWorkerTask(id, { ok: true }, second.lease_token), true);
  } finally {
    await db.query("DELETE FROM apex_worker_tasks WHERE id=$1", [id]).catch(() => {});
    await db.end();
    await closeWorkerStore();
  }
});
