import { mkdir, open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const ROOT = process.env.APEX_SE_X_ROOT || "/srv/apex/se-x";
const WAL_DIR = process.env.APEX_WAL_DIR || path.join(ROOT, "wal");
const FILE = process.env.APEX_WAL_FILE || path.join(WAL_DIR, "ring.wal.jsonl");
const RING_SIZE = Math.max(1024, Number(process.env.APEX_RING_SIZE || 65536));
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
const appendChains = new Map();
const sha = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export class ApexRingWAL {
  constructor({ file = FILE, ringSize = RING_SIZE, maxBytes = DEFAULT_MAX_BYTES } = {}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024) throw new RangeError("WAL maxBytes must be a safe integer of at least 1024 bytes");
    this.file = file; this.ringSize = ringSize; this.maxBytes = maxBytes;
    this.seq = 0; this.lastHash = "0".repeat(64); this.ring = new Array(ringSize);
    this.head = 0; this.count = 0; this.ready = false;
  }

  async init() {
    if (this.ready) return this;
    await mkdir(path.dirname(this.file), { recursive: true });
    try {
      const existing = await stat(this.file);
      if (existing.size > this.maxBytes) {
        const error = new Error(`WAL_CAPACITY_EXCEEDED: existing WAL is ${existing.size} bytes; configured maximum is ${this.maxBytes}. Preserve it and offload/rotate before restarting writers.`);
        error.code = "WAL_CAPACITY_EXCEEDED"; throw error;
      }
      const text = await readFile(this.file, "utf8");
      for (const line of text.split("\n").filter(Boolean).slice(-this.ringSize)) this._load(JSON.parse(line));
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    this.ready = true; return this;
  }

  _load(record) {
    this.seq = Math.max(this.seq, Number(record.seq) || 0);
    this.lastHash = String(record.hash || this.lastHash);
    this.ring[this.head] = record; this.head = (this.head + 1) % this.ringSize;
    this.count = Math.min(this.count + 1, this.ringSize);
  }

  async append(type, payload = {}, meta = {}) {
    await this.init();
    const run = async () => {
      const record = { version: 1, id: randomUUID(), seq: this.seq + 1, ts: new Date().toISOString(), type: String(type), payload, meta, prevHash: this.lastHash };
      record.hash = sha(record);
      const line = JSON.stringify(record) + "\n";
      const lineBytes = Buffer.byteLength(line, "utf8");
      if (lineBytes > this.maxBytes) {
        const error = new Error(`WAL_RECORD_TOO_LARGE: record requires ${lineBytes} bytes; maximum is ${this.maxBytes}.`);
        error.code = "WAL_RECORD_TOO_LARGE"; throw error;
      }
      let currentBytes = 0;
      try { currentBytes = (await stat(this.file)).size; } catch (error) { if (error.code !== "ENOENT") throw error; }
      if (currentBytes + lineBytes > this.maxBytes) {
        const error = new Error(`WAL_CAPACITY_EXCEEDED: append would grow WAL to ${currentBytes + lineBytes} bytes; maximum is ${this.maxBytes}. No data was discarded. Rotate/offload verified segments before retrying.`);
        error.code = "WAL_CAPACITY_EXCEEDED"; throw error;
      }
      const handle = await open(this.file, "a");
      try {
        const openedBytes = (await handle.stat()).size;
        if (openedBytes + lineBytes > this.maxBytes) {
          const error = new Error("WAL_CAPACITY_EXCEEDED: WAL grew before append; no data was written.");
          error.code = "WAL_CAPACITY_EXCEEDED"; throw error;
        }
        await handle.writeFile(line, "utf8"); await handle.sync();
      } finally { await handle.close(); }
      this._load(record); return record;
    };
    const previous = appendChains.get(this.file) || Promise.resolve();
    const next = previous.then(run, run);
    appendChains.set(this.file, next.catch(() => {}));
    return next;
  }

  async replay({ onRecord = () => {} } = {}) {
    await this.init();
    let previousHash = "0".repeat(64), sequence = 0, text = "";
    try { text = await readFile(this.file, "utf8"); } catch (error) { if (error.code === "ENOENT") return 0; throw error; }
    if (Buffer.byteLength(text, "utf8") > this.maxBytes) throw new Error("WAL_CAPACITY_EXCEEDED: replay refused an oversized WAL; preserve it for recovery.");
    let count = 0;
    for (const line of text.split("\n").filter(Boolean)) {
      const record = JSON.parse(line), expectedHash = sha({ ...record, hash: undefined });
      if (record.prevHash !== previousHash || record.hash !== expectedHash || Number(record.seq) !== sequence + 1) throw new Error("WAL integrity failure at sequence " + record.seq);
      await onRecord(record); previousHash = record.hash; sequence = record.seq; count++;
    }
    return count;
  }

  async snapshot() {
    await this.init();
    return { file: this.file, maxBytes: this.maxBytes, sequence: this.seq, head: this.head, count: this.count, lastHash: this.lastHash, ring: this.ring.filter(Boolean) };
  }
}

export const apexRingWAL = new ApexRingWAL();

/** Compatibility facade: never truncate the hash chain; maxBytes is a hard per-file guard, not infinite storage. */
export function createRingWal({ file = FILE, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const wal = new ApexRingWAL({ file, maxBytes });
  async function append(type, payload = {}) { const record = await wal.append(type, payload); return { ...record, at: record.ts }; }
  async function readAll() {
    const records = [];
    await wal.replay({ onRecord: record => records.push({ ...record, at: record.ts }) });
    return records;
  }
  async function compact() { return (await readAll()).length; }
  return { file, append, readAll, compact, maxBytes };
}
