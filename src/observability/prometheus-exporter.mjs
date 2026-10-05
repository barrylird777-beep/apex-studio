import { pool as defaultPool } from "../db/index.ts";

function metricLabel(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export async function scrapePrometheusMetrics(pool = defaultPool) {
  const [taskMetrics, webhookMetrics, recoveryMetrics] = await Promise.all([
    pool.query("SELECT status, COUNT(*)::bigint AS count FROM apex_worker_tasks GROUP BY status"),
    pool.query("SELECT webhook_status, COUNT(*)::bigint AS count FROM apex_worker_tasks WHERE status = 'completed' GROUP BY webhook_status"),
    pool.query("SELECT COALESCE(SUM(recovered_count), 0)::bigint AS recoveries FROM apex_worker_tasks")
  ]);

  const lines = [
    "# HELP apex_worker_tasks_count Number of durable worker tasks by status.",
    "# TYPE apex_worker_tasks_count gauge"
  ];

  const taskStatuses = ["queued", "running", "completed", "failed"];
  const taskCounts = Object.fromEntries(taskStatuses.map(status => [status, 0]));
  for (const row of taskMetrics.rows) {
    if (Object.hasOwn(taskCounts, row.status)) taskCounts[row.status] = Number(row.count) || 0;
  }
  for (const status of taskStatuses) {
    lines.push(`apex_worker_tasks_count{status="${metricLabel(status)}"} ${taskCounts[status]}`);
  }

  lines.push(
    "# HELP apex_webhooks_total Completed worker events grouped by webhook delivery status.",
    "# TYPE apex_webhooks_total gauge"
  );
  const webhookStatuses = ["pending", "sending", "sent", "failed"];
  const webhookCounts = Object.fromEntries(webhookStatuses.map(status => [status, 0]));
  for (const row of webhookMetrics.rows) {
    if (Object.hasOwn(webhookCounts, row.webhook_status)) webhookCounts[row.webhook_status] = Number(row.count) || 0;
  }
  for (const status of webhookStatuses) {
    lines.push(`apex_webhooks_total{status="${metricLabel(status)}"} ${webhookCounts[status]}`);
  }

  lines.push(
    "# HELP apex_worker_lease_recoveries_total Total worker task lease recoveries.",
    "# TYPE apex_worker_lease_recoveries_total counter",
    `apex_worker_lease_recoveries_total ${Number(recoveryMetrics.rows[0]?.recoveries) || 0}`,
    "# HELP apex_worker_tasks_total Total durable worker tasks.",
    "# TYPE apex_worker_tasks_total gauge",
    `apex_worker_tasks_total ${taskStatuses.reduce((sum, status) => sum + taskCounts[status], 0)}`,
    ""
  );

  return lines.join("\n");
}

export function prometheusContentType() {
  return "text/plain; version=0.0.4; charset=utf-8";
}
