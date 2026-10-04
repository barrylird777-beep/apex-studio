import { startProductionDaemon } from "./src/workers/av1-production-daemon.mjs";
import { RenderWorker } from "./src/core/render-worker.mjs";
import { capacitySnapshot } from "./src/core/capacity.mjs";
import { getProjectState } from "./src/services/projectManager.mjs";
import { voiceoverWorkerStatus } from "./src/workers/voiceover-worker.mjs";
import {
  durableWorkerEnabled,
  claimNextWorkerTasks,
  startWorkerTask,
  heartbeatWorkerTask,
  completeWorkerTask,
  failWorkerTask,
  requeueExpiredWorkerTasks,
  releaseWorkerTasks
} from "./src/core/mesh/durable-worker-store.mjs";

async function executePermanentHealthTask(payload = {}) {
  const role = String(payload?.role || "general");
  const startedAt = Date.now();
  if (["project-storage", "media-ingest", "publishing"].includes(role)) {
    await getProjectState();
  } else if (["video-engine", "export", "render-cache", "visual-direction"].includes(role)) {
    await new RenderWorker().available();
  } else if (["voiceover", "audio-reference"].includes(role)) {
    await voiceoverWorkerStatus();
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
  process.title = "apex-av1-production";
  await startProductionDaemon();
} else {
  process.title = "apex-autonomous-worker";
  if (!durableWorkerEnabled()) {
    throw new Error("APEX_WORKER_ONLY requires DATABASE_URL");
  }

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const leaseMs = Math.max(15000, Number(process.env.APEX_WORKER_LEASE_MS || 45000));
  const pollMs = Math.max(250, Number(process.env.APEX_WORKER_POLL_MS || 1000));

  console.log("[apex-worker] durable worker online");

  const concurrency = Math.max(1, Math.min(100, Number(process.env.APEX_WORKER_CONCURRENCY || 32)));
  const batchSize = Math.max(1, Math.min(concurrency, Number(process.env.APEX_WORKER_BATCH_SIZE || 20)));
  let stopping = false;
  const shutdownDeadlineMs = Math.max(5000, Number(process.env.APEX_WORKER_SHUTDOWN_MS || 30000));
  let emptyPolls = 0;

  const executeTask = async (task) => {
    const started = await startWorkerTask(task.id, task.lease_token);
    if (!started) {
      console.warn("[apex-worker] claim lost before start; task will not execute", task.id);
      return;
    }
    const heartbeat = setInterval(() => {
      void heartbeatWorkerTask(task.id, leaseMs, task.lease_token).catch(error => {
        console.error("[apex-worker] heartbeat failed:", error?.message || error);
      });
    }, Math.max(5000, Math.floor(leaseMs / 3)));
    heartbeat.unref?.();
    try {
      const result = await executePermanentHealthTask(task.payload || {});
      const completed = await completeWorkerTask(task.id, result, task.lease_token);
      if (!completed) {
        console.warn("[apex-worker] completion fence rejected", task.id);
        return;
      }
      console.log("[apex-worker] completed", task.id, task.role);
    } catch (error) {
      const failed = await failWorkerTask(task.id, error, task.lease_token).catch(failure => {
        console.error("[apex-worker] durable failure update failed:", failure?.message || failure);
        return false;
      });
      if (!failed) console.warn("[apex-worker] failure fence rejected", task.id);
      console.error("[apex-worker] task failed:", task.id, error?.message || error);
    } finally {
      clearInterval(heartbeat);
    }
  };

  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`[apex-worker] ${signal} received; draining`);
    const deadline = Date.now() + shutdownDeadlineMs;
    while (inFlight.size && Date.now() < deadline) await sleep(250);
    const unstarted = [...claimed.values()].filter(task => !inFlight.has(task.id)).map(task => task.id);
    await releaseWorkerTasks(unstarted).catch(error => console.error('[apex-worker] release failed:', error?.message || error));
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  const inFlight = new Map();
  const claimed = new Map();
  const runTask = async (task) => { claimed.set(task.id, task); inFlight.set(task.id, task); try { await executeTask(task); } finally { inFlight.delete(task.id); claimed.delete(task.id); } };

  while (!stopping) {
    await requeueExpiredWorkerTasks().catch(error => {
      console.error("[apex-worker] reclaim failed:", error?.message || error);
    });

    try {
      const available = Math.max(0, concurrency - inFlight.size);
      if (!available) { await sleep(100); continue; }
      const tasks = await claimNextWorkerTasks(Math.min(batchSize, available), leaseMs);
      if (!tasks.length) {
        emptyPolls = Math.min(emptyPolls + 1, 6);
        const base = Math.min(5000, pollMs * 2 ** emptyPolls);
        const jitter = Math.floor(Math.random() * Math.max(100, base * 0.25));
        await sleep(base + jitter);
        continue;
      }

      emptyPolls = 0;
      await Promise.all(tasks.map(runTask));
    } catch (error) {
      console.error("[apex-worker] queue poll failed:", error?.message || error);
      const base = Math.min(5000, pollMs * 2 ** Math.min(emptyPolls, 6));
      const jitter = Math.floor(Math.random() * Math.max(100, base * 0.25));
      await sleep(base + jitter);
      emptyPolls = Math.min(emptyPolls + 1, 6);
    }
  }
}