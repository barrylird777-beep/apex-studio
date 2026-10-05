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

    const claimAndComplete = async (workerIndex) => {
      let processed = 0;
      for (;;) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const claim = await client.query(`WITH candidate AS (
            SELECT id FROM apex_worker_tasks
            WHERE status='queued' AND payload->>'benchmark'=$1
            ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
          )
          UPDATE apex_worker_tasks t
          SET status='running', attempts=attempts+1, lease_owner=$2,
              lease_token=gen_random_uuid()::text, last_worker_pid=$3,
              lease_expires_at=NOW()+($4::double precision * INTERVAL '1 millisecond'), updated_at=NOW()
          FROM candidate WHERE t.id=candidate.id
          RETURNING t.id,t.lease_token`, [prefix, `warp-benchmark-${workerIndex}`, process.pid, leaseMs]);
          if (!claim.rows.length) { await client.query('COMMIT'); break; }
          const task = claim.rows[0];
          const done = await client.query(`UPDATE apex_worker_tasks
            SET status='completed', lease_owner=NULL, lease_token=NULL, lease_expires_at=NULL,
                result=$3::jsonb, updated_at=NOW()
            WHERE id=$1 AND lease_owner=$2 AND lease_token=$4 AND status='running'`,
            [task.id, `warp-benchmark-${workerIndex}`, JSON.stringify({ workerIndex, benchmark: prefix }), task.lease_token]);
          await client.query('COMMIT');
          if (done.rowCount !== 1) throw new Error(`FENCING FAILURE for task ${task.id}`);
          processed++;
        } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
        finally { client.release(); }
      }
      return processed;
    };
    const workers = Array.from({ length: workerCount }, (_, workerIndex) => claimAndComplete(workerIndex));

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
