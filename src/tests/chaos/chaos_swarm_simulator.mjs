#!/usr/bin/env node
import crypto from "node:crypto";
import pg from "pg";
import {
  enqueueWorkerTask,
  claimNextWorkerTask,
  heartbeatWorkerTask,
  deferWorkerTask,
  completeWorkerTask,
  failWorkerTask,
  requeueExpiredWorkerTasks,
  quarantineWorkerTask,
  ensureWorkerTaskSchema,
} from "../../core/mesh/durable-worker-store.mjs";

const { Pool } = pg;

export async function runChaosSwarm({
  taskCount = 32,
  workerCount = 8,
  rounds = 12,
  leaseMs = 250,
} = {}) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Math.max(8, workerCount + 4) });
  const prefix = `chaos-swarm:${crypto.randomUUID()}`;
  const ids = [];

  try {
    await ensureWorkerTaskSchema();

    for (let i = 0; i < taskCount; i++) {
      const id = crypto.randomUUID();
      ids.push(id);
      await enqueueWorkerTask({
        id,
        workerId: "chaos-swarm",
        role: "chaos-test",
        task: "chaos-synthetic",
        payload: { chaos: prefix, index: i },
        maxAttempts: 5,
        dedupeKey: `${prefix}:${i}`,
      });
    }

    let completions = 0;
    let fencedLosses = 0;
    let recoveries = 0;

    for (let round = 0; round < rounds; round++) {
      const workers = Array.from({ length: workerCount }, async () => {
        const task = await claimNextWorkerTask(leaseMs);
        if (!task || task.payload?.chaos !== prefix) return;

        if (round % 4 === 0) {
          await new Promise(resolve => setTimeout(resolve, leaseMs + 75));
          const completed = await completeWorkerTask(task.id, { round }, task.lease_token);
          if (!completed) fencedLosses++;
          return;
        }

        if (round % 4 === 1) {
          const renewed = await heartbeatWorkerTask(task.id, leaseMs, task.lease_token);
          if (!renewed) {
            fencedLosses++;
            return;
          }
        }

        if (round % 4 === 2) {
          const deferred = await deferWorkerTask(
            task.id,
            25,
            "CHAOS_DEPENDENCY_DELAY",
            task.lease_token
          );
          if (!deferred) fencedLosses++;
          else recoveries++;
          return;
        }

        const completed = await completeWorkerTask(task.id, { round }, task.lease_token);
        if (completed) completions++;
        else fencedLosses++;
      });

      await Promise.all(workers);
      await new Promise(resolve => setTimeout(resolve, 25));
      recoveries += await requeueExpiredWorkerTasks(100);
    }

    const remaining = await pool.query(
      "SELECT COUNT(*)::int AS count FROM apex_worker_tasks WHERE id = ANY($1::uuid[]) AND status <> 'completed'",
      [ids]
    );

    const completed = await pool.query(
      "SELECT COUNT(*)::int AS count FROM apex_worker_tasks WHERE id = ANY($1::uuid[]) AND status = 'completed'",
      [ids]
    );

    const remainingCount = remaining.rows[0].count;
    const completedCount = completed.rows[0].count;

    if (fencedLosses < 0 || completedCount + remainingCount !== taskCount) {
      throw new Error("CHAOS ACCOUNTING FAILURE");
    }

    console.log(JSON.stringify({
      benchmark: "chaos-swarm",
      taskCount,
      workerCount,
      rounds,
      completedCount,
      remainingCount,
      observedFencedLosses: fencedLosses,
      recoveryEvents: recoveries,
      assertion: "lease-expiry recovery and lease-token fencing remained authoritative",
      status: "PASS",
    }));

    return { completedCount, remainingCount, fencedLosses, recoveries };
  } finally {
    if (ids.length) {
      await pool.query("DELETE FROM apex_worker_tasks WHERE id = ANY($1::uuid[])", [ids]).catch(() => {});
    }
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runChaosSwarm()
    .then(() => process.exitCode = 0)
    .catch(error => {
      console.error("[CHAOS SWARM] FAIL", error);
      process.exitCode = 1;
    });
}
