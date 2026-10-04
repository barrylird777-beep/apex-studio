export function createMemoryStore() {
  const jobs = new Map();
  const workers = new Map();
  let seq = 0;
  const view = (j) => (j ? structuredClone(j) : null);
  const live = (j) => j.status === 'queued' || j.status === 'running';
  const guarded = (id, token) => {
    const j = jobs.get(id);
    return j && j.status === 'running' && j.leaseToken === token ? j : null;
  };
  const byStatus = (status) => [...jobs.values()].filter((j) => j.status === status);

  return {
    async enqueue({ id, type, payload, runAt, maxAttempts, dedupeKey, now }) {
      if (dedupeKey) for (const j of jobs.values()) if (j.dedupeKey === dedupeKey && live(j)) return view(j);
      const j = {
        id, type, payload: structuredClone(payload), status: 'queued', runAt, attempts: 0, maxAttempts,
        leaseToken: null, leaseExpiresAt: null, workerId: null, lastError: null, result: null,
        dedupeKey, recoveredCount: 0, createdAt: now, updatedAt: now, _seq: seq++,
      };
      jobs.set(id, j);
      return view(j);
    },

    async claimOne({ workerId, now, leaseMs, token }) {
      const due = byStatus('queued')
        .filter((j) => j.runAt <= now)
        .sort((a, b) => a.runAt - b.runAt || a._seq - b._seq)[0];
      if (!due) return null;
      Object.assign(due, {
        status: 'running', leaseToken: token, leaseExpiresAt: now + leaseMs,
        workerId, attempts: due.attempts + 1, updatedAt: now,
      });
      return view(due);
    },

    async heartbeat({ id, token, now, leaseMs }) {
      const j = guarded(id, token);
      if (!j) return false;
      j.leaseExpiresAt = now + leaseMs;
      j.updatedAt = now;
      return true;
    },

    async complete({ id, token, result, now }) {
      const j = guarded(id, token);
      if (!j) return false;
      Object.assign(j, { status: 'done', result: structuredClone(result), leaseToken: null, leaseExpiresAt: null, updatedAt: now });
      return true;
    },

    async fail({ id, token, error, now, retryAt }) {
      const j = guarded(id, token);
      if (!j) return false;
      Object.assign(j, {
        status: retryAt == null ? 'dead' : 'queued', runAt: retryAt ?? j.runAt,
        lastError: error, leaseToken: null, leaseExpiresAt: null, updatedAt: now,
      });
      return true;
    },

    async listExpired({ now }) {
      return byStatus('running').filter((j) => j.leaseExpiresAt < now).map(view);
    },

    async requeueExpired({ id, token, dead, now, runAt, error }) {
      const j = guarded(id, token);
      if (!j || !(j.leaseExpiresAt < now)) return false;
      Object.assign(j, {
        status: dead ? 'dead' : 'queued', runAt, lastError: error, leaseToken: null,
        leaseExpiresAt: null, recoveredCount: j.recoveredCount + 1, updatedAt: now,
      });
      return true;
    },

    async touchWorker({ id, now, info }) {
      workers.set(id, { id, lastSeen: now, info: structuredClone(info) });
    },
    async listWorkers() { return [...workers.values()].map(view); },
    async counts() {
      const c = { queued: 0, running: 0, done: 0, dead: 0 };
      for (const j of jobs.values()) c[j.status]++;
      return c;
    },
    async listByStatus(status, limit = 50) {
      return byStatus(status).slice(0, limit).map(view);
    },
    async listRetrying(limit = 50) {
      return byStatus('queued').filter((j) => j.attempts > 0).slice(0, limit).map(view);
    },
    async listRecovered(limit = 50) {
      return [...jobs.values()].filter((j) => j.recoveredCount > 0).slice(0, limit).map(view);
    },
  };
}
