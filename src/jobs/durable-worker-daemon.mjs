import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ensureWorkerTaskSchema,
  claimNextWorkerTasks,
  heartbeatWorkerTask,
  completeWorkerTask,
  failWorkerTask,
  requeueExpiredWorkerTasks
} from "../core/mesh/durable-worker-store.mjs";
import { createRenderPool } from "../core/render-pool.mjs";
import { handlers as productionHandlers, closeProductionHandlers } from "./production-handlers.mjs";
import { pollTrendSwarm, closeTrendSwarm } from "../services/trend-swarm.mjs";

const workerId = process.env.APEX_WORKER_ID || `worker-${os.hostname()}-${process.pid}`;
const leaseMs = Math.max(15000, Number(process.env.APEX_WORKER_LEASE_MS || 30000));
const heartbeatMs = Math.max(5000, Math.floor(leaseMs / 3));
const pollMs = Math.max(100, Number(process.env.APEX_WORKER_POLL_MS || 250));
const claimJitterMs = Math.max(0, Number(process.env.APEX_WORKER_CLAIM_JITTER_MS || 0));
const concurrency = Math.max(1, Number(process.env.APEX_WORKER_CONCURRENCY || Number(process.env.APEX_WORKER_FABRIC_IN_FLIGHT || 2000)));
const batchSize = Math.max(1, Number(process.env.APEX_WORKER_BATCH_SIZE || concurrency));
const renderConcurrency = Math.max(1, Number(process.env.APEX_RENDER_CONCURRENCY || concurrency));
const idlePollMs = Math.max(25, Number(process.env.APEX_WORKER_IDLE_POLL_MS || 100));
const trendPollMs = Math.max(30000, Number(process.env.APEX_TREND_POLL_MS || 60000));
const renderPool = createRenderPool({ concurrency: renderConcurrency });
const active = new Set();
let stopping = false;
let nextTrendPoll = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const isRenderJob = job =>
  /(^|[._-])(render|master|encode|transcode)([._-]|$)/i.test(String(job?.type || "")) ||
  job?.payload?.render === true;

function handlerModulePath(modulePath) {
  return path.isAbsolute(modulePath)
    ? modulePath
    : pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..", modulePath)).href;
}

async function handle(job) {
  if (job.type === "sovereign.publish") {
    return { durable: true, accepted: true, waveId: job.payload?.waveId ?? null, executedAt: new Date().toISOString() };
  }

  const modulePath = process.env.APEX_JOB_HANDLER_MODULE;
  const external = modulePath ? await import(handlerModulePath(modulePath)) : null;
  const handler =
    productionHandlers?.[job.type] ??
    external?.handlers?.[job.type] ??
    external?.default?.[job.type] ??
    external?.handleJob ??
    external?.default;

  if (typeof handler !== "function") {
    throw new Error(`No production handler registered for Pure-WAL job type: ${job.type}`);
  }
  return handler(job);
}

async function runJob(job) {
  const heartbeat = setInterval(async () => {
    try {
      const ok = await heartbeatWorkerTask(job.id, leaseMs, job.lease_token, job.lease_fence);
      if (!ok) console.error("[WORKER] lease lost", job.id);
    } catch (error) {
      console.error("[WORKER] heartbeat failed", error?.message || error);
    }
  }, heartbeatMs);
  heartbeat.unref?.();

  try {
    const result = isRenderJob(job) ? await renderPool.run(() => handle(job)) : await handle(job);
    const ok = await completeWorkerTask(job.id, result, job.lease_token, job.lease_fence);
    if (!ok) throw new Error(`stale Pure-WAL worker completion rejected for ${job.id}`);
  } catch (error) {
    const ok = await failWorkerTask(
      job.id,
      error instanceof Error ? error.message : String(error),
      job.lease_token,
      job.lease_fence
    );
    if (!ok && !stopping) console.error("[WORKER] stale failure rejected", job.id);
  } finally {
    clearInterval(heartbeat);
  }
}

async function recover() {
  const recovered = await requeueExpiredWorkerTasks();
  if (recovered) console.log("[WORKER] recovered expired Pure-WAL leases", recovered);
}

async function waitForPureWal() {
  let failures = 0;
  while (!stopping) {
    try {
      await ensureWorkerTaskSchema();
      if (failures) console.log("[WORKER] Pure-WAL storage recovered");
      return true;
    } catch (error) {
      failures = Math.min(failures + 1, 8);
      const base = Math.min(30000, 1000 * 2 ** (failures - 1));
      const jitter = Math.floor(Math.random() * Math.max(100, base * 0.25));
      console.error("[WORKER] Pure-WAL storage unavailable; durable work is paused", error?.message || error);
      await sleep(base + jitter);
    }
  }
  return false;
}

async function main() {
  console.log("[WORKER] starting Pure-WAL worker", workerId);
  while (!stopping) {
    const ready = await waitForPureWal();
    if (!ready) break;
    try {
      if (Date.now() >= nextTrendPoll) {
        nextTrendPoll = Date.now() + trendPollMs;
        void pollTrendSwarm()
          .then(result => console.log("[SWARM] Pure-WAL trend poll", result))
          .catch(error => console.error("[SWARM] trend poll failed", error?.message || error));
      }
      await recover();
      const capacity = concurrency - active.size;
      if (capacity <= 0) { await sleep(25); continue; }
      if (claimJitterMs > 0) await sleep(Math.floor(Math.random() * claimJitterMs));
      const jobs = await claimNextWorkerTasks(Math.min(batchSize, capacity), leaseMs, null, workerId);
      if (!jobs.length) { await sleep(Math.max(pollMs, idlePollMs)); continue; }
      for (const job of jobs) {
        const task = runJob(job);
        active.add(task);
        task.finally(() => active.delete(task)).catch(() => {});
      }
      if (active.size) await Promise.race([...active]);
    } catch (error) {
      console.error("[WORKER] Pure-WAL queue operation failed; pausing durable execution", error?.message || error);
      await waitForPureWal();
    }
  }
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[WORKER] draining on ${signal}`);
  await Promise.allSettled([...active]);
  await closeProductionHandlers().catch(() => {});
  await closeTrendSwarm().catch(() => {});
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

main().catch(async error => {
  console.error("[WORKER] fatal", error);
  await closeProductionHandlers().catch(() => {});
  await closeTrendSwarm().catch(() => {});
  process.exitCode = 1;
});
