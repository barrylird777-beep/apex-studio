const safe = (j) => ({
  id: j.id, type: j.type, status: j.status, attempts: j.attempts, maxAttempts: j.maxAttempts,
  runAt: j.runAt, leaseExpiresAt: j.leaseExpiresAt, workerId: j.workerId,
  lastError: j.lastError, recoveredCount: j.recoveredCount, updatedAt: j.updatedAt,
});

export async function getStatus(queue, { staleWorkerMs = 30_000, limit = 50 } = {}) {
  const t = queue.now();
  const s = queue.store;
  const [counts, active, retrying, recovered, workers] = await Promise.all([
    s.counts(), s.listByStatus('running', limit), s.listRetrying(limit), s.listRecovered(limit), s.listWorkers(),
  ]);
  const ws = workers.map((w) => ({ id: w.id, lastSeen: w.lastSeen, stale: t - w.lastSeen > staleWorkerMs }));
  return {
    now: t, counts, active: active.map(safe), retrying: retrying.map(safe),
    recovered: recovered.map(safe), workers: ws, staleWorkers: ws.filter((w) => w.stale),
  };
}

export function createStatusHandler(queue, { prefix = '/jobs', ...opts } = {}) {
  return async (req, res) => {
    if (req.method !== 'GET') return false;
    const p = new URL(req.url, 'http://x').pathname;
    if (!p.startsWith(`${prefix}/`)) return false;
    const key = { status: null, active: 'active', retrying: 'retrying', recovered: 'recovered', workers: 'workers' }[p.slice(prefix.length + 1)];
    if (key === undefined) return false;
    const st = await getStatus(queue, opts);
    const body = key === null ? st : key === 'workers' ? { workers: st.workers, staleWorkers: st.staleWorkers } : { [key]: st[key] };
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
    return true;
  };
}
