import { randomUUID } from 'node:crypto';

export const DEFAULTS = { leaseMs: 60_000, maxAttempts: 5, baseBackoffMs: 2_000, maxBackoffMs: 300_000 };

export const backoffMs = (attempts, base, max) =>
  Math.min(max, base * 2 ** Math.max(0, attempts - 1));

export function createQueue({
  store, now = Date.now, token = randomUUID,
  leaseMs = DEFAULTS.leaseMs, maxAttempts = DEFAULTS.maxAttempts,
  baseBackoffMs = DEFAULTS.baseBackoffMs, maxBackoffMs = DEFAULTS.maxBackoffMs,
} = {}) {
  if (!store) throw new Error('createQueue requires a store');
  const config = { leaseMs, maxAttempts, baseBackoffMs, maxBackoffMs };
  const msg = (e) => String(e?.message ?? e).slice(0, 500);

  return {
    store, now, config,

    async enqueue({ type, payload = {}, runAt, maxAttempts: max, dedupeKey = null } = {}) {
      if (typeof type !== 'string' || !type.trim()) throw new Error('job type is required');
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('payload must be an object');
      }
      JSON.stringify(payload);
      const t = now();
      return store.enqueue({
        id: randomUUID(), type: type.trim(), payload, runAt: runAt ?? t,
        maxAttempts: max ?? maxAttempts, dedupeKey, now: t,
      });
    },

    async touchWorker(workerId, info = {}) {
      await store.touchWorker({ id: workerId, now: now(), info });
    },

    async claim(workerId) {
      await this.touchWorker(workerId);
      return store.claimOne({ workerId, now: now(), leaseMs, token });
    },

    async heartbeat(job) {
      return store.heartbeat({ id: job.id, token: job.leaseToken, now: now(), leaseMs });
    },

    async complete(job, result = null) {
      return store.complete({ id: job.id, token: job.leaseToken, result, now: now() });
    },

    async fail(job, error) {
      const t = now();
      const retry = error?.retryable !== false && job.attempts < job.maxAttempts;
      return store.fail({
        id: job.id, token: job.leaseToken, error: msg(error), now: t,
        retryAt: retry ? t + backoffMs(job.attempts, baseBackoffMs, maxBackoffMs) : null,
      });
    },

    async recoverStale() {
      const t = now();
      const recovered = [];
      for (const job of await store.listExpired({ now: t })) {
        const dead = job.attempts >= job.maxAttempts;
        const ok = await store.requeueExpired({
          id: job.id, token: job.leaseToken, dead, now: t,
          runAt: t + backoffMs(job.attempts, baseBackoffMs, maxBackoffMs),
          error: `lease expired (worker ${job.workerId ?? 'unknown'}, attempt ${job.attempts})`,
        });
        if (ok) recovered.push({ id: job.id, type: job.type, dead, attempts: job.attempts, workerId: job.workerId });
      }
      return recovered;
    },
  };
}
