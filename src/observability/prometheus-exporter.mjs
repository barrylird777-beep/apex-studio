import { queueStats } from "../core/mesh/durable-worker-store.mjs";

function metricLabel(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export async function scrapePrometheusMetrics() {
  const stats = await queueStats();
  if (!stats.durable) {
    return [
      "# HELP apex_worker_tasks_count Number of durable worker tasks by status.",
      "# TYPE apex_worker_tasks_count gauge",
      'apex_worker_tasks_count{status="queued"} 0',
      'apex_worker_tasks_count{status="running"} 0',
      'apex_worker_tasks_count{status="completed"} 0',
      'apex_worker_tasks_count{status="failed"} 0',
      "apex_worker_tasks_durable 0",
      ""
    ].join("\n");
  }

  const lines = [
    "# HELP apex_worker_tasks_count Number of durable worker tasks by status.",
    "# TYPE apex_worker_tasks_count gauge",
    `apex_worker_tasks_count{status="queued"} ${Number(stats.queued) || 0}`,
    `apex_worker_tasks_count{status="running"} ${Number(stats.running) || 0}`,
    `apex_worker_tasks_count{status="completed"} ${Number(stats.completed) || 0}`,
    `apex_worker_tasks_count{status="failed"} ${Number(stats.failed) || 0}`,
    "# HELP apex_worker_tasks_total Total durable worker tasks.",
    "# TYPE apex_worker_tasks_total gauge",
    `apex_worker_tasks_total ${Number(stats.total) || 0}`,
    "# HELP apex_worker_tasks_durable Whether the durable worker store is configured.",
    "# TYPE apex_worker_tasks_durable gauge",
    "apex_worker_tasks_durable 1",
    ""
  ];

  return lines.map(line => line.replace(/\\n/g, "")).join("\n");
}

export function prometheusContentType() {
  return "text/plain; version=0.0.4; charset=utf-8";
}
