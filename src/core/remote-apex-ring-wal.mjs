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
  constructor({ cas = new RemoteContentAddressedStore(), ringSize = Math.max(1024, Number(process.env.APEX_RING_SIZE || 65536)), maxBytes = Number(process.env.APEX_WAL_MAX_BYTES || 50 * 1024 * 1024), scope = process.env.RAILWAY_SERVICE_NAME || "apex" } = {}) {
    this.cas = cas;
    this.ringSize = ringSize;
    this.maxBytes = maxBytes;
    this.scope = String(scope).replace(/[^a-zA-Z0-9._:-]/g, "-").slice(0, 100);
    this.headKey = "wal-head-" + this.scope;
    this.lockKey = "wal-lock-" + this.scope;
    this.file = "remote://cas/wal/" + this.scope;
    this.seq = 0; this.lastHash = ZERO; this.ring = new Array(ringSize);
    this.head = 0; this.count = 0; this.offset = 0; this.lastExternalRecords = []; this.ready = false; this.initPromise = null;
  }
  _load(record) {
    this.seq = Number(record.seq); this.lastHash = String(record.hash);
    this.ring[this.head] = record; this.head = (this.head + 1) % this.ringSize;
    this.count = Math.min(this.count + 1, this.ringSize);
  }
  async _lock(operation) {
    const started = Date.now(), token = randomUUID();
    let lockHash = null, stopped = false;
    while (true) {
      const current = await this.cas.readRef("system", this.lockKey), now = Date.now();
      if (current && Number(current.value?.leaseUntil || 0) > now) {
        if (now - started > 180000) throw new Error("[REMOTE_WAL_LOCK] Timed out waiting for remote WAL lock.");
        await new Promise(resolve => setTimeout(resolve, 35 + Math.floor(Math.random() * 45))); continue;
      }
      try {
        const acquired = await this.cas.writeRef("system", this.lockKey, { token, leaseUntil: now + 90000, owner: this.scope }, { expectedHash: current?.hash ?? null });
        lockHash = acquired.hash; break;
      } catch (error) {
        if (error.code !== "CAS_CONFLICT") throw error;
        if (now - started > 180000) throw new Error("[REMOTE_WAL_LOCK] Timed out acquiring remote WAL lock.");
      }
    }
    const heartbeat = setInterval(async () => {
      if (stopped || !lockHash) return;
      try {
        const renewed = await this.cas.writeRef("system", this.lockKey, { token, leaseUntil: Date.now() + 90000, owner: this.scope }, { expectedHash: lockHash });
        lockHash = renewed.hash;
      } catch { /* lock expiry permits safe recovery if a renewal loses its CAS */ }
    }, 20000);
    heartbeat.unref?.();
    try { return await operation(); }
    finally {
      stopped = true; clearInterval(heartbeat);
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
    this.seq = sequence;
    this.lastHash = lastHash;
    return head;
  }
  async _records({ onRecord = async () => {}, retainRing = true, allowHeadLag = false, repairHead = false } = {}) {
    this.seq = 0; this.lastHash = ZERO; this.ring = new Array(this.ringSize); this.head = 0; this.count = 0; this.offset = 0;
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
      if (retainRing) this._load(record); else { this.seq = record.seq; this.lastHash = record.hash; }
      previous = record.hash; sequence = record.seq; hashAtSequence.set(sequence, previous); await onRecord(record);
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
      await this.cas.writeRef("system", this.headKey, { seq: sequence, lastHash: previous, updatedAt: new Date().toISOString() }, { expectedHash: head?.hash ?? null });
    }
    return sequence;
  }
  async append(type, payload = {}, meta = {}) {
    await this.init();
    return this._lock(async () => {
      const currentHead = await this._prepareAppendHead();
      const record = { version: 1, id: randomUUID(), seq: this.seq + 1, ts: new Date().toISOString(), type: String(type), payload, meta, prevHash: this.lastHash };
      record.hash = sha(record);
      // Remote WAL is append-only and is not blocked by the legacy local-WAL byte cap.
      // Provider quota/billing remains external; do not silently drop durable records.
      const incoming = Buffer.byteLength(JSON.stringify(record) + "\\n", "utf8");
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
  async snapshot() {
    await this.replay({ retainRing: true });
    return { file: this.file, sequence: this.seq, head: this.head, count: this.count, lastHash: this.lastHash, ring: this.ring.filter(Boolean) };
  }
}
