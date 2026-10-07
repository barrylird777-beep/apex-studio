import os from 'node:os';
import { claimJobs, completeJob, failJob, recoverExpiredJobs } from '../core/sovereign-local-storage.mjs';

const workerId = process.env.APEX_WORKER_ID || `local-${os.hostname()}-${process.pid}`;
const leaseMs = Math.max(5000, Number(process.env.APEX_WORKER_LEASE_MS || 60000));
const pollMs = Math.max(10, Number(process.env.APEX_WORKER_POLL_MS || 100));
const concurrency = Math.max(1, Number(process.env.APEX_WORKER_CONCURRENCY || os.availableParallelism?.() || os.cpus().length || 1));
const active = new Set();
let stopping = false;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const handlerModule = process.env.APEX_JOB_HANDLER_MODULE;

async function handle(job) {
  if (!handlerModule) throw new Error(`No production handler configured for local job type: ${job.type}`);
  const mod = await import(handlerModule);
  const handler = mod.handlers?.[job.type] || mod.default?.[job.type] || mod.handleJob || mod.default;
  if (typeof handler !== 'function') throw new Error(`No production handler registered for: ${job.type}`);
  return handler(job);
}

async function run(job) {
  try {
    const result = await handle(job);
    await completeJob(job, result);
  } catch (error) {
    await failJob(job, error instanceof Error ? error.message : String(error));
  }
}

async function main() {
  console.log('[LOCAL SOVEREIGN WORKER] ONLINE', JSON.stringify({
    workerId,
    concurrency,
    storage: process.env.APEX_SEX_ROOT || '/srv/apex/se-x'
  }));

  while (!stopping) {
    await recoverExpiredJobs();
    const capacity = Math.max(0, concurrency - active.size);
    if (!capacity) {
      await Promise.race([...active]);
      continue;
    }

    const jobs = await claimJobs({ workerId, limit: capacity, leaseMs });
    if (!jobs.length) {
      await sleep(pollMs);
      continue;
    }

    for (const job of jobs) {
      const task = run(job);
      active.add(task);
      task.finally(() => active.delete(task)).catch(() => {});
    }
  }
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[LOCAL SOVEREIGN WORKER] DRAIN ${signal}`);
  await Promise.allSettled([...active]);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
main().catch(error => { console.error('[LOCAL SOVEREIGN WORKER] FATAL', error); process.exitCode = 1; });
