import { PeerContentAddressedStore } from './peer-content-addressed-store.mjs';
/**
 * Peer-only adapter for mesh manifests and runtime queue/state references.
 * It has no local disk, WAL, JSON-log, or legacy fallback.
 */
const validPart = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(value);
const clone = value => value == null ? value : structuredClone(value);

export class PeerMeshCasAdapter {
  constructor({ store, appNamespace } = {}) {
    const production = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    if (production && !(store instanceof PeerContentAddressedStore)) throw new TypeError('Production PeerMeshCasAdapter requires an actual PeerContentAddressedStore instance; test doubles and duck-typed substitutes are forbidden');
    if (!production && (!store || typeof store.readRef !== 'function' || typeof store.writeRef !== 'function' || typeof store.listRefs !== 'function')) throw new TypeError('PeerMeshCasAdapter requires a reference store implementing readRef, writeRef, and listRefs');
    if (!validPart(appNamespace)) throw new TypeError('a canonical application namespace is required');
    this.store = store;
    this.appNamespace = appNamespace;
    // Capability marker consumed only by trusted in-process production wiring.
    // The owning PeerContentAddressedStore enforces peer identity, namespace,
    // encryption, quorum, replica placement, and configured failure domains.
    this.peerOwnedStorage = true;
    this.jobCache = new Map();
    this.initialized = false;
  }

  refKey(namespace, key) {
    // Composite collection/record keys use slash-delimited validated segments.
    // Validate every segment independently so nested keys stay confined without
    // rejecting the adapter's own collection/id key format.
    const segments = typeof key === 'string' ? key.split('/') : [];
    if (!validPart(namespace) || !segments.length || !segments.every(validPart)) {
      throw new TypeError('invalid peer reference namespace or key');
    }
    return namespace + '/' + segments.join('/');
  }

  async init() {
    await this.store.listRefs();
    const jobs = await this.store.listRefs();
    this.jobCache.clear();
    for (const ref of jobs) {
      if (ref.namespace === this.appNamespace && ref.key.startsWith('jobs/')) {
        const job = ref.value?.job;
        if (job?.id != null) this.jobCache.set(String(job.id), clone(job));
      }
    }
    this.initialized = true;
    return this;
  }

  async readRef(namespace, key) { return this.store.readRef(this.refKey(namespace, key)); }
  async writeRef(namespace, key, value, options = {}) {
    return this.store.writeRef(this.refKey(namespace, key), value, options);
  }
  async listRefs(namespace) {
    if (!validPart(namespace)) throw new TypeError('invalid mesh reference namespace');
    const prefix = namespace + '/';
    return (await this.store.listRefs())
      .filter(ref => ref.namespace === this.appNamespace && ref.key.startsWith(prefix))
      .map(ref => ({ ...ref, namespace, key: ref.key.slice(prefix.length) }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  async get(collection, id) {
    const ref = await this.readRef('state', this.refKey(collection, id));
    return clone(ref?.value?.record ?? null);
  }
  async put(collection, id, record) {
    const key = this.refKey(collection, id);
    const value = { ...clone(record), id: String(id), updatedAt: new Date().toISOString() };
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await this.readRef('state', key);
      try {
        await this.writeRef('state', key, { collection: String(collection), id: String(id), record: value },
          { expectedHash: current?.hash ?? null });
        return clone(value);
      } catch (error) {
        if (error.code !== 'CAS_CONFLICT' || attempt === 7) throw error;
      }
    }
    throw new Error('peer state CAS retries exhausted');
  }
  async list(collection) {
    const prefix = String(collection) + '/';
    const refs = await this.listRefs('state');
    return refs.filter(ref => ref.key.startsWith(prefix) && !ref.value?.deleted)
      .map(ref => clone(ref.value?.record)).filter(Boolean);
  }

  jobs() { return [...this.jobCache.values()].map(clone); }
  async refreshJobs() { await this.init(); return this; }

  async enqueue({ id, type, payload = {}, runAt = Date.now(), maxAttempts = 5, dedupeKey = null, priority = 0 } = {}) {
    if (!type) throw new Error('job type required');
    await this.init();
    const statuses = type === 'sovereign.app.dispatch' ? ['queued', 'running', 'completed', 'dead'] : ['queued', 'running'];
    if (dedupeKey) {
      const existing = this.jobs().find(job => job.dedupeKey === String(dedupeKey) && statuses.includes(job.status));
      if (existing) return { durable: true, id: existing.id, duplicate: true, status: existing.status };
    }
    const jobId = String(id || crypto.randomUUID());
    const job = {
      id: jobId, type: String(type), payload: clone(payload), priority: Number(priority) || 0,
      status: 'queued', attempts: 0, maxAttempts: Math.max(1, Number(maxAttempts) || 5),
      dedupeKey: dedupeKey == null ? null : String(dedupeKey), runAt: Number(runAt) || Date.now(),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      leaseOwner: null, leaseToken: null, leaseFence: 0, leaseExpiresAt: 0, recoveredCount: 0
    };
    const result = await this.writeRef('jobs', jobId, { id: jobId, job }, { expectedHash: null });
    this.jobCache.set(jobId, job);
    return { durable: true, id: jobId, duplicate: false, status: job.status, hash: result.hash };
  }

  async claim({ workerId = 'peer-runtime', limit = 1, leaseMs = 45000, role = null, onlyId = null } = {}) {
    await this.init();
    const now = Date.now(), claimed = [];
    const candidates = this.jobs().filter(job => job.status === 'queued' && Number(job.runAt || 0) <= now &&
      (onlyId == null || String(job.id) === String(onlyId)) &&
      (role ? String(job.payload?._apex_worker?.role || '') === role : String(job.payload?._apex_worker?.role || '') !== 'sovereign-runtime'))
      .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || Number(a.runAt || 0) - Number(b.runAt || 0));
    for (const candidate of candidates) {
      if (claimed.length >= Math.max(1, Number(limit) || 1)) break;
      const current = await this.readRef('jobs', candidate.id);
      if (!current?.value?.job || current.value.job.status !== 'queued') continue;
      const job = current.value.job;
      const next = { ...job, status: 'running', leaseOwner: String(workerId), leaseToken: crypto.randomUUID(),
        leaseFence: Number(job.leaseFence || 0) + 1, leaseExpiresAt: now + Math.max(1000, Number(leaseMs) || 45000),
        attempts: Number(job.attempts || 0) + 1, updatedAt: new Date().toISOString() };
      try {
        await this.writeRef('jobs', candidate.id, { id: candidate.id, job: next }, { expectedHash: current.hash });
        this.jobCache.set(candidate.id, next);
        claimed.push(clone(next));
      } catch (error) { if (error.code !== 'CAS_CONFLICT') throw error; }
    }
    return claimed;
  }

  async transition(id, operation, { leaseToken, leaseFence, leaseMs = 45000, result = null, error = null, delayMs = 1000, reason = '' } = {}) {
    const current = await this.readRef('jobs', String(id));
    const job = current?.value?.job;
    if (!job || job.status !== 'running' || job.leaseToken !== leaseToken ||
        (leaseFence != null && Number(job.leaseFence) !== Number(leaseFence)) || Number(job.leaseExpiresAt || 0) <= Date.now()) return false;
    const patch = { updatedAt: new Date().toISOString() };
    if (operation === 'heartbeat') patch.leaseExpiresAt = Date.now() + Math.max(1000, Number(leaseMs) || 45000);
    else if (operation === 'complete') Object.assign(patch, { status: 'completed', result: clone(result), leaseOwner: null, leaseToken: null, leaseExpiresAt: 0, completedAt: new Date().toISOString() });
    else if (operation === 'defer') Object.assign(patch, { status: 'queued', runAt: Date.now() + Math.max(1, Number(delayMs) || 1), lastError: String(reason).slice(0, 4000), leaseOwner: null, leaseToken: null, leaseExpiresAt: 0 });
    else if (operation === 'fail') {
      const dead = Number(job.attempts) >= Number(job.maxAttempts);
      Object.assign(patch, { status: dead ? 'dead' : 'queued', runAt: dead ? job.runAt : Date.now() + Math.min(300000, 2 ** Number(job.attempts) * 1000),
        lastError: 'Worker task failed', leaseOwner: null, leaseToken: null, leaseExpiresAt: 0 });
    } else throw new Error('unsupported peer queue transition');
    const next = { ...job, ...patch };
    try {
      await this.writeRef('jobs', String(id), { id: String(id), job: next }, { expectedHash: current.hash });
      this.jobCache.set(String(id), next);
      return true;
    } catch (failure) { if (failure.code === 'CAS_CONFLICT') return false; throw failure; }
  }
}
export default PeerMeshCasAdapter;
