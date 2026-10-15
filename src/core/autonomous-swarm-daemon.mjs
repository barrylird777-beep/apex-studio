import { randomUUID } from 'node:crypto';
import { ApexPureStore } from './apex-pure-store.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createAutonomousSwarmDaemon({ pollMs = 1000, maxBackoffMs = 30000,
  handler = async () => {}, workerId = process.env.APEX_SWARM_WORKER_ID || 'apex-swarm-' + randomUUID() } = {}) {
  const store = new ApexPureStore();
  let running = false;
  let timer = null;
  let failures = 0;
  let cycleCount = 0;
  let initialized = false;

  async function ensureReady() {
    if (initialized) return;
    await store.init();
    initialized = true;
  }

  async function recordEvent(type, payload) {
    await store.put('swarm-events', randomUUID(), { type, payload, at: new Date().toISOString() });
  }

  async function cycle() {
    if (!running) return;
    cycleCount++;
    try {
      await ensureReady();
      const jobs = await store.claim({ workerId, limit: 1, leaseMs: 30000 });
      if (jobs.length) {
        const job = jobs[0];
        try {
          const result = await handler(job.payload, job);
          const completed = await store.transition(job.id, 'complete', {
            leaseToken: job.leaseToken, leaseFence: job.leaseFence, result
          });
          if (!completed) throw new Error('swarm job lease was lost before completion');
          failures = 0;
          await recordEvent('completed', { id: job.id, type: job.type, resultCid: job.resultCid || null });
        } catch (error) {
          failures++;
          await store.transition(job.id, 'fail', {
            leaseToken: job.leaseToken, leaseFence: job.leaseFence, error
          });
          await recordEvent('failed', { id: job.id, type: job.type, error: String(error?.message || error) });
        }
      } else {
        failures = 0;
      }
    } catch (error) {
      failures++;
      await recordEvent('daemon-error', { error: String(error?.message || error) }).catch(() => {});
    }
    if (running) {
      const delay = Math.min(maxBackoffMs, Math.max(pollMs, pollMs * 2 ** Math.min(failures, 5)));
      timer = setTimeout(() => { timer = null; void cycle(); }, delay);
      timer.unref?.();
    }
  }

  return {
    async start() {
      if (running) return this.status();
      running = true;
      failures = 0;
      await ensureReady();
      await cycle();
      return this.status();
    },
    async stop() {
      running = false;
      if (timer) { clearTimeout(timer); timer = null; }
      return this.status();
    },
    status() {
      return { running, failures, cycleCount, storage: 'peer-cas', appNamespace: store.appNamespace, workerId, pollMs, maxBackoffMs };
    }
  };
}

export async function enqueueSwarmItem({ item } = {}) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError('item is required');
  const store = new ApexPureStore();
  await store.init();
  const queued = await store.enqueue({
    id: String(item.id || randomUUID()),
    type: String(item.type || 'swarm.item'),
    payload: item,
    runAt: Number(item.runAt) || Date.now(),
    maxAttempts: Number(item.maxAttempts) || 5,
    dedupeKey: item.dedupeKey == null ? null : String(item.dedupeKey),
    priority: Number(item.priority) || 0
  });
  return { ...item, id: queued.id, durable: queued.durable, duplicate: queued.duplicate === true, status: queued.status };
}
