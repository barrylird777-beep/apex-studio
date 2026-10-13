import { createHash, randomUUID } from "node:crypto";
import { RemoteContentAddressedStore } from "./remote-content-addressed-store.mjs";

const sha = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const ZERO = "0".repeat(64);
const keyFor = seq => "r" + String(seq).padStart(20, "0");

/**
 * Remote append-only WAL. Records and the sequence head live in the remote CAS;
 * appends are serialized with a leased, CAS-protected lock. No local files are touched.
 */
export class RemoteApexRingWAL {
  constructor({ cas = new RemoteContentAddressedStore(), ringSize = Math.max(1024, Number(process.env.APEX_RING_SIZE || 65536)), maxBytes = Number(process.env.APEX_WAL_MAX_BYTES || 50 * 1024 * 1024), scope = process.env.RAILWAY_SERVICE_NAME || "apex", clock = () => Date.now(), random = () => Math.random(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), scheduleInterval = (callback, ms) => { const handle = setInterval(callback, ms); handle.unref?.(); return () => clearInterval(handle); }, tokenFactory = randomUUID } = {}) {
    if (typeof clock !== "function" || typeof random !== "function" || typeof sleep !== "function" || typeof scheduleInterval !== "function" || typeof tokenFactory !== "function") {
      throw new TypeError("clock, random, sleep, scheduleInterval, and tokenFactory must be functions");
    }
    this.cas = cas;
    this.clock = clock;
    this.random = random;
    this.sleep = sleep;
    this.scheduleInterval = scheduleInterval;
    this.tokenFactory = tokenFactory;
    this.timestamp = () => new Date(this.clock()).toISOString();
    this.ringSize = ringSize;
    this.maxBytes = maxBytes;
    this.scope = String(scope).replace(/[^a-zA-Z0-9._:-]/g, "-").slice(0, 100);
    this.headKey = "wal-head-" + this.scope;
    this.lockKey = "wal-lock-" + this.scope;
    this.file = "remote://cas/wal/" + this.scope;
    this.seq = 0; this.lastHash = ZERO; this.ring = new Array(ringSize);
    this.head = 0; this.count = 0; this.offset = 0; this.idempotencyIndex = new Map(); this.lastExternalRecords = []; this.ready = false; this.initPromise = null;
  }
  _indexRecord(record) {
    const key = record?.meta?.idempotencyKey == null ? "" : String(record.meta.idempotencyKey);
    if (!key) return;
    const previous = this.idempotencyIndex.get(key);
    if (previous != null && previous !== Number(record.seq)) {
      throw new Error("[REMOTE_WAL_IDEMPOTENCY] Duplicate idempotency key at sequence " + record.seq);
    }
    this.idempotencyIndex.set(key, Number(record.seq));
  }
  _load(record) {
    this.seq = Number(record.seq); this.lastHash = String(record.hash);
    this._indexRecord(record);
    this.ring[this.head] = record; this.head = (this.head + 1) % this.ringSize;
    this.count = Math.min(this.count + 1, this.ringSize);
  }
  async _lock(operation) {
    const started = this.clock(), token = this.tokenFactory();
    let lockHash = null, stopped = false;
    while (true) {
      const current = await this.cas.readRef("system", this.lockKey), now = this.clock();
      if (current && Number(current.value?.leaseUntil || 0) > now) {
        if (now - started > 180000) throw new Error("[REMOTE_WAL_LOCK] Timed out waiting for remote WAL lock.");
        await this.sleep(35 + Math.floor(this.random() * 45)); continue;
      }
      try {
        const acquired = await this.cas.writeRef("system", this.lockKey, { token, leaseUntil: now + 90000, owner: this.scope }, { expectedHash: current?.hash ?? null });
        lockHash = acquired.hash; break;
      } catch (error) {
        if (error.code !== "CAS_CONFLICT") throw error;
        if (now - started > 180000) throw new Error("[REMOTE_WAL_LOCK] Timed out acquiring remote WAL lock.");
      }
    }
    const stopHeartbeat = this.scheduleInterval(async () => {
      if (stopped || !lockHash) return;
      try {
        const renewed = await this.cas.writeRef("system", this.lockKey, { token, leaseUntil: this.clock() + 90000, owner: this.scope }, { expectedHash: lockHash });
        lockHash = renewed.hash;
      } catch { /* lock expiry permits safe recovery if a renewal loses its CAS */ }
    }, 20000);
    try { return await operation(); }
    finally {
      stopped = true; stopHeartbeat();
      if (lockHash) await this.cas.deleteRef("system", this.lockKey, { expectedHash: lockHash }).catch(() => {});
    }
  }
  async init() {
    if (this.ready) return this;
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      await this.cas.init();
      await this.replay({ retainRing: true });
      this.ready = true;
      return this;
    })();
    try { return await this.initPromise; }
    catch (error) { this.initPromise = null; throw error; }
  }
  async _prepareAppendHead() {
    let head = await this.cas.readRef("system", this.headKey);
    if (!head) {
      const first = await this.cas.readRef("wal", this.scope + "-" + keyFor(1));
      if (first) {
        await this._records({ retainRing: true, allowHeadLag: true, repairHead: true });
        head = await this.cas.readRef("system", this.headKey);
      } else {
        if (this.seq > 0) throw new Error("[REMOTE_WAL_INTEGRITY] Remote WAL head and first record disappeared.");
        this.seq = 0; this.lastHash = ZERO;
        return null;
      }
    }
    const validHead = value => value && Number.isSafeInteger(Number(value.seq)) &&
      Number(value.seq) >= 1 && /^[a-f0-9]{64}$/.test(String(value.lastHash || ""));
    if (!validHead(head?.value)) throw new Error("[REMOTE_WAL_INTEGRITY] Invalid remote WAL head.");
    let sequence = Number(head.value.seq);
    let lastHash = String(head.value.lastHash);
    let last = await this.cas.readRef("wal", this.scope + "-" + keyFor(sequence));
    const validLast = row => {
      if (!row?.value) return false;
      const { hash, ...body } = row.value;
      return row.value.seq === sequence && row.value.hash === lastHash && hash === sha(body);
    };
    const next = await this.cas.readRef("wal", this.scope + "-" + keyFor(sequence + 1));
    if (!validLast(last) || next) {
      await this._records({ retainRing: true, allowHeadLag: true, repairHead: true });
      head = await this.cas.readRef("system", this.headKey);
      if (!head || !validHead(head.value)) throw new Error("[REMOTE_WAL_INTEGRITY] Unable to recover remote WAL head.");
      sequence = Number(head.value.seq);
      lastHash = String(head.value.lastHash);
      last = await this.cas.readRef("wal", this.scope + "-" + keyFor(sequence));
      if (!last || last.value?.seq !== sequence || last.value?.hash !== lastHash) {
        throw new Error("[REMOTE_WAL_INTEGRITY] Recovered remote WAL head does not match its final record.");
      }
      const stillNext = await this.cas.readRef("wal", this.scope + "-" + keyFor(sequence + 1));
      if (stillNext) throw new Error("[REMOTE_WAL_INTEGRITY] Remote WAL contains an unexpected record after its head.");
    }
    if (sequence > this.seq) {
      let previousHash = this.lastHash;
      for (let nextSequence = this.seq + 1; nextSequence <= sequence; nextSequence += 1) {
        const row = await this.cas.readRef("wal", this.scope + "-" + keyFor(nextSequence));
        const record = row?.value;
        const { hash, ...body } = record || {};
        if (!record || record.seq !== nextSequence || record.prevHash !== previousHash || hash !== sha(body)) {
          throw new Error("[REMOTE_WAL_INTEGRITY] Remote WAL append gap or hash mismatch at record " + nextSequence);
        }
        this._load(record);
        previousHash = record.hash;
      }
    }
    if (this.seq !== sequence || this.lastHash !== lastHash) {
      throw new Error("[REMOTE_WAL_INTEGRITY] Local WAL cursor does not match remote head.");
    }
    return head;
  }
  async _records({ onRecord = async () => {}, retainRing = true, allowHeadLag = false, repairHead = false } = {}) {
    this.seq = 0; this.lastHash = ZERO; this.ring = new Array(this.ringSize); this.head = 0; this.count = 0; this.offset = 0; this.idempotencyIndex = new Map();
    const refs = (await this.cas.listRefs("wal")).filter(ref => String(ref.key).startsWith(this.scope + "-r")).sort((a,b) => String(a.key).localeCompare(String(b.key)));
    let previous = ZERO, sequence = 0, bytes = 0;
    const hashAtSequence = new Map([[0, ZERO]]);
    for (const ref of refs) {
      const record = ref.value;
      const { hash, ...body } = record || {};
      if (!record || !Number.isSafeInteger(record.seq) || record.seq !== sequence + 1 || record.prevHash !== previous || record.hash !== sha(body)) {
        throw new Error("[REMOTE_WAL_INTEGRITY] Hash chain or sequence failure at record " + (sequence + 1));
      }
      bytes += Buffer.byteLength(JSON.stringify(record) + "\n", "utf8");
      if (retainRing) this._load(record); else { this.seq = record.seq; this.lastHash = record.hash; this._indexRecord(record); }
      previous = record.hash; sequence = record.seq; hashAtSequence.set(sequence, previous);
    }
    this.offset = bytes;
    const head = await this.cas.readRef("system", this.headKey);
    const headSeq = head ? Number(head.value?.seq) : 0;
    const headHash = head ? String(head.value?.lastHash || "") : ZERO;
    const exact = headSeq === sequence && headHash === previous;
    const validLag = allowHeadLag && Number.isSafeInteger(headSeq) && headSeq >= 0 && headSeq < sequence && hashAtSequence.get(headSeq) === headHash;
    const missingHeadWithRecords = allowHeadLag && !head && sequence > 0;
    if (!exact && !validLag && !missingHeadWithRecords) {
      throw new Error("[REMOTE_WAL_INTEGRITY] Remote WAL head does not match record chain.");
    }
    // A crash can occur after the immutable record is committed but before its
    // head ref advances. Repair only while the caller holds the remote append lock.
    if (repairHead && !exact) {
      await this.cas.writeRef("system", this.headKey, { seq: sequence, lastHash: previous, updatedAt: this.timestamp() }, { expectedHash: head?.hash ?? null });
    }
    for (const ref of refs) await onRecord(ref.value);
    return sequence;
  }
  async append(type, payload = {}, meta = {}) {
    await this.init();
    return this._lock(async () => {
      const currentHead = await this._prepareAppendHead();
      const idempotencyKey = meta?.idempotencyKey == null ? "" : String(meta.idempotencyKey);
      const requestMeta = { ...(meta || {}) };
      delete requestMeta.idempotencyKey;
      delete requestMeta.requestHash;
      const idempotencyPayload = requestMeta.idempotencyPayload;
      delete requestMeta.idempotencyPayload;
      const requestHash = sha({ type: String(type), payload: idempotencyPayload === undefined ? payload : idempotencyPayload, meta: requestMeta });
      if (idempotencyKey) {
        const existingSequence = this.idempotencyIndex.get(idempotencyKey);
        if (existingSequence != null) {
          const existing = (await this.cas.readRef("wal", this.scope + "-" + keyFor(existingSequence)))?.value;
          if (!existing || existing.meta?.idempotencyKey !== idempotencyKey) {
            throw new Error("[REMOTE_WAL_IDEMPOTENCY] Index points to a missing or mismatched record.");
          }
          if (existing.meta?.requestHash !== requestHash) {
            throw Object.assign(new Error("[REMOTE_WAL_IDEMPOTENCY] Idempotency key was reused with a different request."), { code: "IDEMPOTENCY_CONFLICT" });
          }
          Object.defineProperty(existing, "externalRecords", { value: this.lastExternalRecords.slice(), enumerable: false });
          return existing;
        }
      }
      const recordMeta = idempotencyKey ? { ...requestMeta, idempotencyKey, requestHash } : meta;
      const record = { version: 1, id: this.tokenFactory(), seq: this.seq + 1, ts: this.timestamp(), type: String(type), payload, meta: recordMeta, prevHash: this.lastHash };
      record.hash = sha(record);
      // Remote WAL is append-only and is not blocked by the legacy local-WAL byte cap.
      // Provider quota/billing remains external; do not silently drop durable records.
      const incoming = Buffer.byteLength(JSON.stringify(record) + "\n", "utf8");
      const recordKey = this.scope + "-" + keyFor(record.seq);
      await this.cas.writeRef("wal", recordKey, record, { expectedHash: null });
      await this.cas.writeRef("system", this.headKey, { seq: record.seq, lastHash: record.hash, updatedAt: record.ts }, { expectedHash: currentHead?.hash ?? null });
      this._load(record); this.offset += incoming;
      Object.defineProperty(record, "externalRecords", { value: this.lastExternalRecords.slice(), enumerable: false });
      return record;
    });
  }
  async refresh({ onRecord = async () => {} } = {}) {
    const before = this.seq, records = [];
    await this._records({ retainRing: true, onRecord: async record => { if (record.seq > before) { records.push(record); await onRecord(record); } } });
    this.lastExternalRecords = records; return records.length;
  }
  async replay({ onRecord = async () => {}, retainRing = true } = {}) {
    await this.cas.init();
    const count = await this._records({ onRecord, retainRing, allowHeadLag: true }); this.ready = true; return count;
  }
  async replayReadOnly({ onRecord = async () => {}, retainRing = false } = {}) {
    await this.cas.init();
    const count = await this._records({ onRecord, retainRing }); this.ready = true; return count;
  }
  async recover({ onRecord = async () => {}, retainRing = true } = {}) {
    await this.cas.init();
    return this._lock(async () => {
      const count = await this._records({ onRecord, retainRing, allowHeadLag: true, repairHead: true });
      this.ready = true;
      return count;
    });
  }
  async snapshot() {
    await this.replay({ retainRing: true });
    return { file: this.file, sequence: this.seq, head: this.head, count: this.count, lastHash: this.lastHash, ring: this.ring.filter(Boolean) };
  }
}
