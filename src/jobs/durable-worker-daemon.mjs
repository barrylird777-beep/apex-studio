import os from 'node:os';
import { createDurableJobsStore } from './durable-jobs-store.mjs';
import { createRenderPool } from '../core/render-pool.mjs';
import { handlers as productionHandlers, closeProductionHandlers } from './production-handlers.mjs';
import { pollTrendSwarm, closeTrendSwarm } from '../services/trend-swarm.mjs';

const workerId = process.env.APEX_WORKER_ID || `worker-${os.hostname()}-${process.pid}`;
const leaseMs = Math.max(15000, Number(process.env.APEX_WORKER_LEASE_MS || 30000));
const heartbeatMs = Math.max(5000, Math.floor(leaseMs / 3));
const pollMs = Math.max(100, Number(process.env.APEX_WORKER_POLL_MS || 250));
const claimJitterMs = Math.max(0, Number(process.env.APEX_WORKER_CLAIM_JITTER_MS || 0));
const concurrency = Math.max(1, Math.min(32, Number(process.env.APEX_WORKER_CONCURRENCY || 32)));
const batchSize = Math.max(1, Math.min(concurrency, Number(process.env.APEX_WORKER_BATCH_SIZE || 20)));
const renderConcurrency = Math.max(1, Math.min(16, Number(process.env.APEX_RENDER_CONCURRENCY || 8)));
const idlePollMs = Math.max(25, Number(process.env.APEX_WORKER_IDLE_POLL_MS || 100));
const trendPollMs = Math.max(30000, Number(process.env.APEX_TREND_POLL_MS || 60000));

const store = createDurableJobsStore();
const renderPool = createRenderPool({ concurrency: renderConcurrency });
const active = new Set();
let stopping = false;
let nextTrendPoll = 0;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const isRenderJob = job =>
  /(^|[._-])(render|master|encode|transcode)([._-]|$)/i.test(String(job?.type || '')) ||
  job?.payload?.render === true;

function retryDelayMs(attempts) {
  const exponent = Math.max(0, Number(attempts) - 1);
  const base = Math.min(60000, 1000 * 2 ** exponent);
  return Math.min(60000, base + Math.floor(Math.random() * Math.max(250, base * 0.25)));
}

async function handle(job) {
  if (job.type === 'sovereign.publish') {
    return { durable: true, accepted: true, waveId: job.payload?.waveId ?? null, executedAt: new Date().toISOString() };
  }

  const modulePath = process.env.APEX_JOB_HANDLER_MODULE;
  const external = modulePath ? await import(modulePath) : null;
  const handler =
    productionHandlers?.[job.type] ??
    external?.handlers?.[job.type] ??
    external?.default?.[job.type] ??
    external?.handleJob ??
    external?.default;

  if (typeof handler !== 'function') {
    throw new Error(`No production handler registered for durable job type: ${job.type}`);
  }
  return handler(job);
}

async function runJob(job) {
  const heartbeat = setInterval(async () => {
    try {
      const ok = await store.heartbeat({
        id: job.id,
        token: job.leaseToken,
        fence: job.leaseFence,
        now: new Date(),
        leaseMs
      });
      if (!ok) console.error('[WORKER] lease lost', job.id);
    } catch (error) {
      console.error('[WORKER] heartbeat failed', error);
    }
  }, heartbeatMs);
  heartbeat.unref?.();

  try {
    const result = isRenderJob(job)
      ? await renderPool.run(() => handle(job))
      : await handle(job);

    const ok = await store.complete({
      id: job.id,
      token: job.leaseToken,
      fence: job.leaseFence,
      result,
      now: new Date()
    });
    if (!ok) throw new Error(`stale worker completion rejected for ${job.id}`);
  } catch (error) {
    const retry = Number(job.attempts) < Number(job.maxAttempts);
    const retryAt = retry ? new Date(Date.now() + retryDelayMs(job.attempts)) : null;
    const ok = await store.fail({
      id: job.id,
      token: job.leaseToken,
      fence: job.leaseFence,
      error: error instanceof Error ? error.message : String(error),
      now: new Date(),
      retryAt
    });
    if (!ok && !stopping) console.error('[WORKER] stale failure rejected', job.id);
  } finally {
    clearInterval(heartbeat);
  }
}

async function recover() {
  const rows = await store.recoverExpired({
    now: new Date(),
    runAt: new Date(Date.now() + 1000),
    errorFor: 'worker lease expired; task recovered'
  });
  if (rows.length) console.log('[WORKER] recovered', rows.length);
}

async function main() {
  console.log('[WORKER] online', workerId);

  while (!stopping) {
    if (Date.now() >= nextTrendPoll) {
      nextTrendPoll = Date.now() + trendPollMs;
      void pollTrendSwarm()
        .then(result => console.log('[SWARM] trend poll', result))
        .catch(error => console.error('[SWARM] trend poll failed', error));
    }

    await recover();

    const capacity = concurrency - active.size;
    if (capacity <= 0) {
      await sleep(25);
      continue;
    }

    if (claimJitterMs > 0) {
      await sleep(Math.floor(Math.random() * claimJitterMs));
    }

    const jobs = await store.claimBatch({
      workerId,
      now: new Date(),
      leaseMs,
      batchSize: Math.min(batchSize, capacity)
    });

    if (!jobs.length) {
      await sleep(Math.max(pollMs, idlePollMs));
      continue;
    }

    for (const job of jobs) {
      const task = runJob(job);
      active.add(task);
      task.finally(() => active.delete(task)).catch(() => {});
    }

    if (active.size) await Promise.race([...active]);
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

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

main().catch(async error => {
  console.error('[WORKER] fatal', error);
  await closeProductionHandlers().catch(() => {});
  await closeTrendSwarm().catch(() => {});
  process.exitCode = 1;
});
