import crypto from "node:crypto";
import { claimExternalEffect, completeExternalEffect } from "../core/mesh/durable-worker-store.mjs";

export async function dispatchCompletedWorkerEvents({
  fetchImpl = globalThis.fetch,
  webhookUrl = process.env.APEX_WEBHOOK_URL,
  limit = 20,
  timeoutMs = 10000
} = {}) {
  if (!webhookUrl) return { enabled: false, dispatched: 0 };
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");

  const { Pool } = await import("pg");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return { enabled: false, dispatched: 0 };

  const pool = new Pool({ connectionString, max: 2 });
  let dispatched = 0;
  try {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const result = await pool.query(
      `SELECT id, role, task, payload, result, trace_id
         FROM apex_worker_tasks
        WHERE status='completed' AND webhook_dispatched_at IS NULL
        ORDER BY updated_at
        FOR UPDATE SKIP LOCKED
        LIMIT $1`,
      [safeLimit]
    );

    for (const row of result.rows) {
      const eventId = `worker.completed:${row.id}`;
      if (!(await claimExternalEffect(eventId))) continue;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(webhookUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-apex-event-id": eventId,
            "x-apex-event-type": "worker.completed"
          },
          body: JSON.stringify({
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
          "UPDATE apex_worker_tasks SET webhook_dispatched_at=NOW(), updated_at=NOW() WHERE id=$1 AND webhook_dispatched_at IS NULL",
          [row.id]
        );
        dispatched++;
      } catch (error) {
        // Leave the external-effect record started so a retry remains observable.
        // The receiver must deduplicate by X-Apex-Event-Id.
      } finally {
        clearTimeout(timer);
      }
    }
  } finally {
    await pool.end();
  }
  return { enabled: true, dispatched };
}

export function webhookEventId(taskId) {
  return `worker.completed:${crypto.createHash("sha256").update(String(taskId)).digest("hex").slice(0, 32)}`;
}
