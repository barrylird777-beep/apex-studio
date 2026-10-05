import crypto from "node:crypto";
import { Pool } from "pg";
import { claimExternalEffect, completeExternalEffect } from "../core/mesh/durable-worker-store.mjs";

function eventIdFor(taskId) {
  return `worker.completed:${crypto.createHash("sha256").update(String(taskId)).digest("hex").slice(0, 32)}`;
}

export async function dispatchCompletedWorkerEvents({
  fetchImpl = globalThis.fetch,
  webhookUrl = process.env.APEX_WEBHOOK_URL,
  limit = 20,
  timeoutMs = 10000,
  pool: providedPool = null
} = {}) {
  if (!webhookUrl) return { enabled: false, dispatched: 0, failed: 0 };
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString && !providedPool) return { enabled: false, dispatched: 0, failed: 0 };

  const pool = providedPool || new Pool({ connectionString, max: 2 });
  let dispatched = 0;
  let failed = 0;
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const safeTimeout = Math.max(1000, Math.min(60000, Number(timeoutMs) || 10000));

  try {
    const result = await pool.query(
      `SELECT id, role, task, payload, result, trace_id
         FROM apex_worker_tasks
        WHERE status = 'completed'
          AND webhook_dispatched_at IS NULL
        ORDER BY updated_at, id
        LIMIT $1`,
      [safeLimit]
    );

    for (const row of result.rows) {
      const eventId = eventIdFor(row.id);
      if (!(await claimExternalEffect(eventId))) continue;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), safeTimeout);
      try {
        const response = await fetchImpl(webhookUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-apex-event-id": eventId,
            "x-apex-event-type": "worker.completed",
            ...(row.trace_id ? { "x-trace-id": row.trace_id } : {})
          },
          body: JSON.stringify({
            event: "worker.completed",
            id: row.id,
            role: row.role,
            task: row.task,
            payload: row.payload,
            result: row.result,
            traceId: row.trace_id
          }),
          signal: controller.signal
        });

        if (!response.ok) throw new Error(`Webhook HTTP ${response.status}`);

        await completeExternalEffect(eventId, { status: response.status });
        await pool.query(
          `UPDATE apex_worker_tasks
              SET webhook_dispatched_at = NOW(), updated_at = NOW()
            WHERE id = $1
              AND status = 'completed'
              AND webhook_dispatched_at IS NULL`,
          [row.id]
        );
        dispatched++;
      } catch {
        failed++;
        // Do not mark the task dispatched. The next dispatcher pass retries it.
      } finally {
        clearTimeout(timer);
      }
    }
  } finally {
    if (!providedPool) await pool.end();
  }

  return { enabled: true, dispatched, failed };
}

export function webhookEventId(taskId) {
  return eventIdFor(taskId);
}
