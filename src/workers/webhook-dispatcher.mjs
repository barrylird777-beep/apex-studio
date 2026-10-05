import crypto from "node:crypto";
import { pool as dbPool } from "../db/index.ts";
import { claimExternalEffect, completeExternalEffect } from "../core/mesh/durable-worker-store.mjs";

function eventIdFor(taskId) {
  return `worker.completed:${crypto.createHash("sha256").update(String(taskId)).digest("hex").slice(0, 32)}`;
}

function backoffMs(attempt) {
  const exponent = Math.min(Math.max(0, Number(attempt) - 1), 8);
  const base = Math.min(300000, 1000 * 2 ** exponent);
  return Math.round(base * (0.75 + Math.random() * 0.5));
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

  const pool = providedPool || dbPool;
  let dispatched = 0;
  let failed = 0;
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const safeTimeout = Math.max(1000, Math.min(60000, Number(timeoutMs) || 10000));

  try {
    const result = await pool.query(
      `SELECT id, role, task, payload, result, trace_id, webhook_attempts
         FROM apex_worker_tasks
        WHERE status = 'completed'
          AND webhook_dispatched_at IS NULL
          AND webhook_status IN ('pending', 'failed')
          AND webhook_next_attempt_at <= NOW()
        ORDER BY webhook_next_attempt_at, updated_at, id
        LIMIT $1`,
      [safeLimit]
    );

    for (const row of result.rows) {
      const eventId = eventIdFor(row.id);
      if (!(await claimExternalEffect(eventId))) continue;

      const attempt = Number(row.webhook_attempts || 0) + 1;
      await pool.query(
        `UPDATE apex_worker_tasks
            SET webhook_status = 'sending',
                webhook_attempts = $2,
                webhook_last_error = NULL,
                updated_at = NOW()
          WHERE id = $1
            AND status = 'completed'
            AND webhook_dispatched_at IS NULL`,
        [row.id, attempt]
      );

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
              SET webhook_status = 'sent',
                  webhook_dispatched_at = NOW(),
                  webhook_last_error = NULL,
                  webhook_next_attempt_at = NULL,
                  updated_at = NOW()
            WHERE id = $1
              AND status = 'completed'
              AND webhook_dispatched_at IS NULL`,
          [row.id]
        );
        dispatched++;
      } catch (error) {
        failed++;
        const delay = backoffMs(attempt);
        const message = error instanceof Error ? error.message : String(error);
        await pool.query(
          `UPDATE apex_worker_tasks
              SET webhook_status = 'failed',
                  webhook_last_error = $2,
                  webhook_next_attempt_at = NOW() + ($3 * INTERVAL '1 millisecond'),
                  updated_at = NOW()
            WHERE id = $1
              AND status = 'completed'
              AND webhook_dispatched_at IS NULL`,
          [row.id, message.slice(0, 4000), delay]
        );
      } finally {
        clearTimeout(timer);
      }
    }
  }

  return { enabled: true, dispatched, failed };
}

export function webhookEventId(taskId) {
  return eventIdFor(taskId);
}
