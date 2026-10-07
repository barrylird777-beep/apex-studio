import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ApexRingWAL } from "./apex-ring-wal.mjs";

const ROOT = process.env.APEX_SE_X_ROOT || "/srv/apex/se-x";
const DATA = process.env.APEX_DATA_DIR || path.join(ROOT, "data");
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const safe = value => String(value).replace(/[^a-zA-Z0-9._-]/g, "_");

export class ApexPureDataStore {
  constructor({ root = DATA, ring = new ApexRingWAL() } = {}) {
    this.root = root;
    this.ring = ring;
    this.collections = new Map();
    this.ready = false;
  }

  async init() {
    if (this.ready) return this;
    await mkdir(this.root, { recursive: true });
    await this.ring.init();
    await this.ring.replay({ onRecord: record => this.apply(record) });
    this.ready = true;
    return this;
  }

  collection(name) {
    const key = safe(name);
    if (!this.collections.has(key)) this.collections.set(key, new Map());
    return this.collections.get(key);
  }

  statePath(collection, id) {
    return path.join(this.root, safe(collection), safe(id) + ".json");
  }

  async atomicWrite(file, value) {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = file + "." + process.pid + "." + randomUUID() + ".tmp";
    await writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
    await rename(tmp, file);
  }

  apply(record) {
    const { type, payload = {} } = record;
    if (type === "data.put") this.collection(payload.collection).set(String(payload.id), clone(payload.record));
    if (type === "data.delete") this.collection(payload.collection).delete(String(payload.id));
  }

  async list(collection) {
    await this.init();
    return [...this.collection(collection).values()].map(clone);
  }

  async get(collection, id) {
    await this.init();
    const row = this.collection(collection).get(String(id));
    return row ? clone(row) : null;
  }

  async put(collection, id, record) {
    await this.init();
    const value = {
      ...clone(record),
      id: String(id),
      updatedAt: new Date().toISOString()
    };
    const walRecord = await this.ring.append("data.put", {
      collection,
      id: String(id),
      record: value
    });
    this.apply(walRecord);
    await this.atomicWrite(this.statePath(collection, id), value);
    return clone(value);
  }

  async create(collection, record = {}) {
    const id = String(record.id || randomUUID());
    return this.put(collection, id, { ...record, id });
  }

  async delete(collection, id) {
    await this.init();
    const walRecord = await this.ring.append("data.delete", {
      collection,
      id: String(id)
    });
    this.apply(walRecord);
    return true;
  }

  async query(collection, predicate = () => true, { sort, limit = 10000 } = {}) {
    let rows = (await this.list(collection)).filter(predicate);
    if (sort) rows.sort(sort);
    return rows.slice(0, Math.max(1, Number(limit) || 10000));
  }

  async snapshot() {
    await this.init();
    return {
      root: ROOT,
      data: this.root,
      collections: [...this.collections.entries()].map(([name, map]) => ({
        name,
        size: map.size
      }))
    };
  }
}

export const apexPureDataStore = new ApexPureDataStore();
