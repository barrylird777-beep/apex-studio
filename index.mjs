import { RenderWorker } from "./src/core/render-worker.mjs";
import { capacitySnapshot } from "./src/core/capacity.mjs";
import { getProjectState } from "./src/services/projectManager.mjs";
import {
  durableWorkerEnabled,
  claimNextWorkerTasks,
  heartbeatWorkerTask,
  heartbeatWorkerTasks,
  completeWorkerTask,
  failWorkerTask,
  requeueExpiredWorkerTasks,
  releaseWorkerTasks
} from "./src/core/mesh/durable-worker-store.mjs";
import { pool as dbPool } from "./src/db/index";
import { createEpisodeJobDispatcher } from "./src/core/mesh/episode-job-dispatcher.mjs";
import { runWithTrace, log } from "./src/core/resilience/load-shedder.mjs";
import { APEX_LIMITS } from "./src/core/mesh/apex-limits.mjs";

async function executePermanentHealthTask(payload = {}) {
  const role = String(payload?.role || "general");
  const startedAt = Date.now();
  if (["project-storage", "media-ingest", "publishing"].includes(role)) {
    await getProjectState();
  } else if (["video-engine", "export", "render-cache", "visual-direction"].includes(role)) {
    await new RenderWorker().available();
  } else if (["voiceover", "audio-reference"].includes(role)) {
    const { voiceoverWorkerStatus } = await import("./src/workers/voiceover-worker.mjs");
    await voiceoverWorkerStatus();
  } else if (role === "security-observation") {
    const report = payload?.report;
    if (!report || report.classification !== "behavioral_heuristic" || report.telemetryOnly !== true) {
      throw new Error("Security observation task requires behavioral telemetry");
    }
    log("warn", "High-confidence wireless anomaly queued for configured downstream alert workflow", {
      threat_count: Number(report.threatCount || 0),
      high_confidence_count: Number(report.highConfidenceCount || 0),
      classification: report.classification
    });
  } else {
    capacitySnapshot();
  }
  return {
    ok: true,
    workerId: String(payload?.workerId || ""),
    role,
    task: String(payload?.task || ""),
    durationMs: Date.now() - startedAt,
    completedAt: new Date().toISOString()
  };
}

const workerOnly = String(process.env.APEX_WORKER_ONLY || "").toLowerCase() === "true";

if (!workerOnly) {
  throw new Error("index.mjs is reserved for the PostgreSQL durable worker; set APEX_WORKER_ONLY=true");
} else {
  process.title = "apex-autonomous-worker";
  if (!durableWorkerEnabled()) throw new Error("APEX_WORKER_ONLY requires DATABASE_URL");

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const leaseMs = Math.max(15000, Number(process.env.APEX_WORKER_LEASE_MS || APEX_LIMITS.WORKER.LEASE_TTL_SECONDS * 1000));
  const pollMs = Math.max(250, Number(process.env.APEX_WORKER_POLL_MS || 1000));
  const concurrency = Math.max(1, Math.min(APEX_LIMITS.WORKER.MAX_CONCURRENCY, Number(process.env.APEX_WORKER_CONCURRENCY || APEX_LIMITS.WORKER.CONCURRENCY)));
  const batchSize = Math.max(1, Math.min(concurrency, Number(process.env.APEX_WORKER_BATCH_SIZE || APEX_LIMITS.WORKER.BATCH_SIZE)));
  const shutdownDeadlineMs = Math.max(5000, Number(process.env.APEX_WORKER_SHUTDOWN_MS || 30000));
  let stopping = false;
  let emptyPolls = 0;

  const dispatchEpisodeJob = createEpisodeJobDispatcher({ pool: dbPool });

  console.log("[apex-worker] durable worker online");

  const inFlight = new Map();
  const claimed = new Map();
  const started = new Set();
  const heartbeatInterval = Math.max(5000, Math.floor(leaseMs / 3));
  const reclaimInterval = Math.max(5000, Number(process.env.APEX_WORKER_RECLAIM_MS || 15000));
  let lastReclaimAt = 0;

  const executeTask = async (task) => {
    try {
      const result = await runWithTrace(
        { job_id: String(task.id), worker_id: String(task.lease_owner || ""), episode_id: String(task.payload?.episodeId || "") },
        async () => {
          const dispatched = await dispatchEpisodeJob(task);
          if (dispatched !== null) return dispatched;
          if (String(task?.payload?.type || "") === "permanent-health") {
            return executePermanentHealthTask(task.payload || {});
          }
          throw new Error(`Unknown durable worker task: role=${String(task?.role || "")} task=${String(task?.task || "")}`);
        }
      );
      if (result?.deferred) return;
      const completed = await completeWorkerTask(task.id, result, task.lease_token);
      if (!completed) {
        console.warn("[apex-worker] completion fenced out", task.id, task.role);
        return;
      }
      log("info", "worker task completed", { job_id: task.id, role: task.role });
    } catch (error) {
      await failWorkerTask(task.id, error, task.lease_token).then(ok => {
        if (!ok) console.warn("[apex-worker] failure update fenced out", task.id);
      }).catch(failure => {
        console.error("[apex-worker] durable failure update failed:", failure?.message || failure);
      });
      console.error("[apex-worker] task failed:", task.id, error?.message || error);
    }
  };

  const runTask = async (task) => {
    claimed.set(task.id, task);
    started.add(task.id);
    inFlight.set(task.id, task);
    try { await executeTask(task); }
    finally {
      inFlight.delete(task.id);
      started.delete(task.id);
      claimed.delete(task.id);
    }
  };

  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`[apex-worker] ${signal} received; draining`);
    const deadline = Date.now() + shutdownDeadlineMs;
    while (inFlight.size && Date.now() < deadline) await sleep(250);

    const unstartedTasks = [...claimed.values()].filter(task => !started.has(task.id));
    if (unstartedTasks.length) {
      await releaseWorkerTasks(
        unstartedTasks.map(task => task.id),
        unstartedTasks.map(task => task.lease_token)
      ).catch(error => {
        console.error("[apex-worker] release failed:", error?.message || error);
      });
    }
    process.exit(0);
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  const heartbeatLoop = (async () => {
    while (!stopping) {
      await sleep(heartbeatInterval);
      if (stopping || !inFlight.size) continue;
      await heartbeatWorkerTasks([...inFlight.values()], leaseMs).catch(error => {
        console.error("[apex-worker] batch heartbeat failed:", error?.message || error);
      });
    }
  })();

  while (!stopping) {
    if (Date.now() - lastReclaimAt >= reclaimInterval) {
      lastReclaimAt = Date.now();
      await requeueExpiredWorkerTasks().catch(error => {
        console.error("[apex-worker] reclaim failed:", error?.message || error);
      });
    }

    try {
      const available = Math.max(0, concurrency - inFlight.size);
      if (!available) {
        await sleep(100);
        continue;
      }

      const tasks = await claimNextWorkerTasks(Math.min(batchSize, available), leaseMs);
      if (!tasks.length) {
        emptyPolls = Math.min(emptyPolls + 1, 6);
        const base = Math.min(5000, pollMs * 2 ** emptyPolls);
        const jitter = Math.floor(Math.random() * Math.max(100, base * 0.25));
        await sleep(base + jitter);
        continue;
      }

      emptyPolls = 0;
      // Keep the claim pipeline full while tasks execute; inFlight is the backpressure boundary.
      for (const task of tasks) void runTask(task);
      await sleep(0);
    } catch (error) {
      console.error("[apex-worker] queue poll failed:", error?.message || error);
      const base = Math.min(5000, pollMs * 2 ** Math.min(emptyPolls, 6));
      const jitter = Math.floor(Math.random() * Math.max(100, base * 0.25));
      await sleep(base + jitter);
      emptyPolls = Math.min(emptyPolls + 1, 6);
    }
  }
}
