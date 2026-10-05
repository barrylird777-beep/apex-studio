#!/usr/bin/env node
import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import pg from "pg";
import {
  enqueueWorkerTask,
  claimNextWorkerTask,
  completeWorkerTask,
  ensureWorkerTaskSchema,
} from "../../core/mesh/durable-worker-store.mjs";

const { Pool } = pg;

export async function runWarpBenchmark({
  taskCount = 100,
  workerCount = 10,
  leaseMs = 30000,
} = {}) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const prefix = `warp-benchmark:${crypto.randomUUID()}`;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Math.max(5, workerCount + 2) });
  const ids = [];

  try {
    await ensureWorkerTaskSchema();
    const start = performance.now();

    await Promise.all(Array.from({ length: taskCount }, (_, index) => {
      const id = crypto.randomUUID();
      ids.push(id);
      return enqueueWorkerTask({
        id,
        workerId: `warp-benchmark-${index % workerCount}`,
        role: "warp-benchmark",
        task: "synthetic-warp",
        payload: { index, benchmark: prefix },
        maxAttempts: 1,
        dedupeKey: `${prefix}:${index}`,
      });
    }));

    const workers = Array.from({ length: workerCount }, async (_, workerIndex) => {
      let processed = 0;
      for (;;) {
        const task = await claimNextWorkerTask(leaseMs);
        if (!task) break;
        if (task.payload?.benchmark !== prefix) {
          await completeWorkerTask(task.id, { ignored: true }, task.lease_token);
          continue;
        }
        const completed = await completeWorkerTask(
          task.id,
          { workerIndex, benchmark: prefix },
          task.lease_token
        );
        if (!completed) throw new Error(`FENCING FAILURE for task ${task.id}`);
        processed++;
      }
      return processed;
    });

    const results = await Promise.all(workers);
    const totalProcessed = results.reduce((sum, value) => sum + value, 0);
    const durationMs = performance.now() - start;
    const throughput = durationMs > 0 ? totalProcessed / (durationMs / 1000) : 0;

    if (totalProcessed !== taskCount) {
      throw new Error(`WARP BENCHMARK INCOMPLETE: ${totalProcessed}/${taskCount}`);
    }

    console.log(JSON.stringify({
      benchmark: "warp-swarm",
      taskCount,
      workerCount,
      totalProcessed,
      durationMs: Number(durationMs.toFixed(2)),
      throughputTasksPerSecond: Number(throughput.toFixed(2)),
      fencing: "lease-token",
      queue: "apex_worker_tasks",
      status: "PASS",
    }));

    return { taskCount, workerCount, totalProcessed, durationMs, throughput };
  } finally {
    if (ids.length) {
      await pool.query(
        "DELETE FROM apex_worker_tasks WHERE id = ANY($1::uuid[])",
        [ids]
      ).catch(() => {});
    }
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runWarpBenchmark()
    .then(() => process.exitCode = 0)
    .catch((error) => {
      console.error("[SWARM BENCHMARK] FAIL", error);
      process.exitCode = 1;
    });
}
