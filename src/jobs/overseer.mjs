export const nonRetryable = (message) =>
  Object.assign(new Error(message), { retryable: false });

export function createOverseer({
  queue, handlers, workerId = `overseer-${process.pid}`, concurrency = 1,
  pollMs = 1000, recoverEveryMs = 15_000, heartbeatMs, log = () => {},
} = {}) {
  if (!queue || !handlers) throw new Error('createOverseer requires queue and handlers');
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('concurrency must be a positive integer');
  const hbMs = heartbeatMs ?? Math.max(10, Math.floor(queue.config.leaseMs / 3));
  let running = false;
  let loops = [];
  let lastRecover = 0;

  async function runOnce() {
    const job = await queue.claim(workerId);
    if (!job) return null;
    const handler = handlers[job.type];
    if (!handler) {
      const ok = await queue.fail(job, nonRetryable(`no handler for job type "${job.type}"`));
      return { id: job.id, status: ok ? 'failed' : 'lease_lost' };
    }

    const ac = new AbortController();
    const timer = setInterval(async () => {
      try {
        if (!(await queue.heartbeat(job))) {
          ac.abort(new Error('lease lost'));
          clearInterval(timer);
        }
      } catch (e) {
        log(`heartbeat error for ${job.id}: ${e.message}`);
      }
    }, hbMs);
    timer.unref?.();

    try {
      const result = await handler(job.payload, { job, signal: ac.signal });
      clearInterval(timer);
      const ok = await queue.complete(job, result ?? null);
      return { id: job.id, status: ok ? 'done' : 'lease_lost' };
    } catch (e) {
      clearInterval(timer);
      if (ac.signal.aborted) return { id: job.id, status: 'lease_lost' };
      const ok = await queue.fail(job, e);
      log(`job ${job.id} (${job.type}) failed: ${e.message}`);
      return { id: job.id, status: ok ? 'failed' : 'lease_lost' };
    }
  }

  async function maybeRecover() {
    const t = queue.now();
    if (t - lastRecover < recoverEveryMs) return [];
    lastRecover = t;
    const rec = await queue.recoverStale();
    if (rec.length) log(`recovered ${rec.length} expired lease(s)`);
    return rec;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function loop() {
    while (running) {
      try {
        await maybeRecover();
        const r = await runOnce();
        if (!r) await sleep(pollMs);
      } catch (e) {
        log(`overseer loop error: ${e.message}`);
        await sleep(pollMs);
      }
    }
  }

  return {
    runOnce,
    recover: () => { lastRecover = 0; return maybeRecover(); },
    start() {
      if (running) return;
      running = true;
      loops = Array.from({ length: concurrency }, loop);
    },
    async stop() {
      running = false;
      await Promise.all(loops);
      loops = [];
    },
  };
}
