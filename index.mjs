import { startProductionDaemon } from "./src/workers/av1-production-daemon.mjs";
import { RenderWorker } from "./src/core/render-worker.mjs";
import { capacitySnapshot } from "./src/core/capacity.mjs";
import { getProjectState } from "./src/services/projectManager.mjs";
import { voiceoverWorkerStatus } from "./src/workers/voiceover-worker.mjs";
import {
  durableWorkerEnabled,
  claimNextWorkerTasks,
  heartbeatWorkerTask,
  completeWorkerTask,
  failWorkerTask,
  requeueExpiredWorkerTasks
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
  let emptyPolls = 0;

  const executeTask = async (task) => {
    const heartbeat = setInterval(() => {
      void heartbeatWorkerTask(task.id, leaseMs).catch(error => {
        console.error("[apex-worker] heartbeat failed:", error?.message || error);
      });
    }, Math.max(5000, Math.floor(leaseMs / 3)));
    heartbeat.unref?.();
    try {
      const result = await executePermanentHealthTask(task.payload || {});
      await completeWorkerTask(task.id, result);
      console.log("[apex-worker] completed", task.id, task.role);
    } catch (error) {
      await failWorkerTask(task.id, error).catch(failure => {
        console.error("[apex-worker] durable failure update failed:", failure?.message || failure);
      });
      console.error("[apex-worker] task failed:", task.id, error?.message || error);
    } finally {
      clearInterval(heartbeat);
    }
  };

  while (true) {
    await requeueExpiredWorkerTasks().catch(error => {
      console.error("[apex-worker] reclaim failed:", error?.message || error);
    });

    try {
      const tasks = await claimNextWorkerTasks(batchSize, leaseMs);
      if (!tasks.length) {
        emptyPolls = Math.min(emptyPolls + 1, 6);
        const base = Math.min(5000, pollMs * 2 ** emptyPolls);
        const jitter = Math.floor(Math.random() * Math.max(100, base * 0.25));
        await sleep(base + jitter);
        continue;
      }

      emptyPolls = 0;
      await Promise.all(tasks.slice(0, concurrency).map(executeTask));
    } catch (error) {
      console.error("[apex-worker] queue poll failed:", error?.message || error);
      const base = Math.min(5000, pollMs * 2 ** Math.min(emptyPolls, 6));
      const jitter = Math.floor(Math.random() * Math.max(100, base * 0.25));
      await sleep(base + jitter);
      emptyPolls = Math.min(emptyPolls + 1, 6);
    }
  }
}