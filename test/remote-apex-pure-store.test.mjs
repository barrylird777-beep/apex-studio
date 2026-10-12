import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { ApexPureStore } from "../src/core/apex-pure-store.mjs";
import { ApexRingWAL } from "../src/core/apex-ring-wal.mjs";
import { RemoteApexRingWAL } from "../src/core/remote-apex-ring-wal.mjs";

const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
class MemoryCAS {
  constructor() { this.refs = new Map(); }
  async init() { return this; }
  async readRef(ns, key) {
    const row = this.refs.get(ns + "/" + key);
    return row ? { namespace: ns, key, hash: row.hash, value: structuredClone(row.value) } : null;
  }
  async writeRef(ns, key, value, { expectedHash } = {}) {
    const id = ns + "/" + key, current = this.refs.get(id), actual = current?.hash ?? null;
    if (expectedHash !== undefined && expectedHash !== actual) throw Object.assign(new Error("CAS conflict"), { code: "CAS_CONFLICT" });
    const hash = digest(value);
    this.refs.set(id, { hash, value: structuredClone(value) });
    return { namespace: ns, key, hash };
  }
  async deleteRef(ns, key, { expectedHash } = {}) {
    const id = ns + "/" + key, current = this.refs.get(id);
    if (!current) return false;
    if (expectedHash !== undefined && current.hash !== expectedHash) throw Object.assign(new Error("CAS conflict"), { code: "CAS_CONFLICT" });
    this.refs.delete(id); return true;
  }
  async listRefs(ns) {
    const prefix = ns + "/";
    return [...this.refs.entries()].filter(([id]) => id.startsWith(prefix)).map(([id,row]) => ({ namespace: ns, key: id.slice(prefix.length), hash: row.hash, value: structuredClone(row.value) }));
  }
}

test("remote Pure-WAL mode persists records and jobs without creating local record mirrors", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-remote-store-"));
  try {
    const cas = new MemoryCAS();
    const store = new ApexPureStore({ root, wal: new ApexRingWAL({ file: path.join(root, "wal", "ring.wal.jsonl") }), cas });
    await store.init();
    assert.ok(store.wal instanceof RemoteApexRingWAL, "remote mode must select a remote WAL");
    const walRecord = await store.wal.append("test.remote-wal", { durable: true });
    assert.equal(walRecord.seq, 1);
    await assert.rejects(access(path.join(root, "wal")), { code: "ENOENT" });
    const reloaded = new ApexPureStore({ root, wal: new ApexRingWAL({ file: path.join(root, "wal", "ring.wal.jsonl") }), cas });
    await reloaded.init();
    const remoteWalSnapshot = await reloaded.wal.snapshot();
    assert.equal(remoteWalSnapshot.sequence, 1);
    assert.equal(remoteWalSnapshot.lastHash, walRecord.hash);
    await assert.rejects(access(path.join(root, "wal")), { code: "ENOENT" });
    const saved = await store.put("app_records", "record-1", { title: "durable remotely" });
    assert.equal(saved.id, "record-1");
    assert.deepEqual(await store.get("app_records", "record-1"), saved);
    await assert.rejects(access(path.join(root, "app_records")), { code: "ENOENT" });
    const queued = await store.enqueue({ id: "job-1", type: "test.remote", payload: { ok: true } });
    assert.equal(queued.durable, true);
    const claimed = await store.claim({ workerId: "remote-test", limit: 1 });
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].id, "job-1");
    assert.equal(await store.delete("app_records", "record-1"), true);
    assert.equal(await store.get("app_records", "record-1"), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("remote migration imports local CAS records without deleting the source", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-remote-migration-"));
  try {
    const localCas = (await import("../src/core/content-addressed-store.mjs")).ContentAddressedStore;
    const source = await new localCas({ root: path.join(root, ".apex-cas") }).init();
    const sourceRef = await source.writeRef("state", "legacy-key", { collection: "legacy", id: "record-7", record: { id: "record-7", keep: true } });
    const remote = new MemoryCAS();
    const store = new ApexPureStore({ root, wal: new ApexRingWAL({ file: path.join(root, "wal", "ring.wal.jsonl") }), cas: remote });
    await store.init();
    assert.deepEqual((await remote.readRef("state", "legacy-key")).value.record, { id: "record-7", keep: true });
    assert.deepEqual((await source.readRef("state", "legacy-key")).value.record, { id: "record-7", keep: true });
    assert.ok(sourceRef.hash);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("remote migration replays a full local WAL without acquiring a local lock", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-remote-wal-readonly-"));
  try {
    const wal = new ApexRingWAL({ file: path.join(root, "wal", "ring.wal.jsonl") });
    await wal.append("state.put", { collection: "legacy", id: "wal-record", record: { id: "wal-record", fromWal: true } });
    wal._acquireLock = async () => { throw new Error("read-only migration must not acquire a local lock"); };
    const remote = new MemoryCAS();
    const store = new ApexPureStore({ root, wal, cas: remote });
    await store.init();
    const imported = await remote.readRef("state", store.refKey("legacy", "wal-record"));
    assert.deepEqual(imported.value.record, { id: "wal-record", fromWal: true });
  } finally { await rm(root, { recursive: true, force: true }); }
});
