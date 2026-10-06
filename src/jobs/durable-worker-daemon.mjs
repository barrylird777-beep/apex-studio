import os from 'node:os';
import pg from 'pg';
import { createDurableJobsStore } from './durable-jobs-store.mjs';

const { Pool } = pg;
const workerId = process.env.APEX_WORKER_ID || `worker-${os.hostname()}-${process.pid}`;
const leaseMs = Number(process.env.APEX_WORKER_LEASE_MS || 30000);
const heartbeatMs = Math.max(1000, Math.floor(leaseMs / 3));
const pollMs = Number(process.env.APEX_WORKER_POLL_MS || 250);

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.APEX_PG_POOL_SIZE || 20),
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  ssl: process.env.APEX_PG_SSL === 'false' ? false : { rejectUnauthorized: false }
});
const store = createDurableJobsStore(pool);
let stopping = false;
const active = new Set();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function handle(job) {
  if (job.type === 'sovereign.publish' || job.type === 'render.dispatch') {
    return { accepted: true, waveId: job.payload?.waveId ?? null };
  }
  if (job.type === 'sovereign.peer.accept') return { accepted: true };
  throw new Error(`No handler registered for durable job type: ${job.type}`);
}

async function runJob(job) {
  const heartbeat = setInterval(async () => {
    try {
      const ok = await store.heartbeat({ id: job.id, token: job.leaseToken, fence: job.leaseFence, now: new Date(), leaseMs });
      if (!ok) console.error('[WORKER] lease lost', job.id);
    } catch (error) { console.error('[WORKER] heartbeat failed', error); }
  }, heartbeatMs);

  try {
    const result = await handle(job);
    const ok = await store.complete({ id: job.id, token: job.leaseToken, fence: job.leaseFence, result, now: new Date() });
    if (!ok) throw new Error(`stale worker completion rejected for ${job.id}`);
  } catch (error) {
    const retry = job.attempts < job.maxAttempts;
    const delay = Math.min(60000, 1000 * 2 ** Math.max(0, job.attempts - 1));
    const retryAt = retry ? new Date(Date.now() + delay) : null;
    const ok = await store.fail({
      id: job.id, token: job.leaseToken, fence: job.leaseFence,
      error: error instanceof Error ? error.message : String(error),
      now: new Date(), retryAt
    });
    if (!ok && !stopping) console.error('[WORKER] stale failure rejected', job.id);
  } finally { clearInterval(heartbeat); }
}

async function recover() {
  const rows = await store.recoverExpired({
    now: new Date(), runAt: new Date(Date.now() + 1000),
    errorFor: 'worker lease expired; task recovered'
  });
  if (rows.length) console.log('[WORKER] recovered', rows.length);
}

async function main() {
  await pool.query('SELECT 1');
  console.log('[WORKER] online', workerId);
  while (!stopping) {
    await recover();
    const job = await store.claimOne({ workerId, now: new Date(), leaseMs });
    if (!job) { await sleep(pollMs); continue; }
    const task = runJob(job);
    active.add(task);
    try { await task; } finally { active.delete(task); }
  }
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[WORKER] draining on ${signal}`);
  await Promise.allSettled([...active]);
  await pool.end();
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

main().catch(async (error) => {
  console.error('[WORKER] fatal', error);
  await pool.end().catch(() => {});
  process.exitCode = 1;
});
