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
  constructor() { this.refs = new Map(); this.listCalls = new Map(); }
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
    this.listCalls.set(ns, (this.listCalls.get(ns) || 0) + 1);
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
    assert.ok(store.wal instanceof RemoteApexRingWAL, "remote mode must use the remote CAS WAL");
    const walRecord = await store.wal.append("proof.record", { durable: true });
    assert.equal(walRecord.seq, 1);
    assert.equal((await store.wal.snapshot()).sequence, 1);
    const durable = await store.put("app_records", "no-wal-proof", { durable: true });
    assert.equal(durable.id, "no-wal-proof");
    await assert.rejects(access(path.join(root, "wal")), { code: "ENOENT" });
    const reloaded = new ApexPureStore({ root, wal: new ApexRingWAL({ file: path.join(root, "wal", "ring.wal.jsonl") }), cas });
    await reloaded.init();
    assert.deepEqual(await reloaded.get("app_records", "no-wal-proof"), durable);
    assert.ok(reloaded.wal instanceof RemoteApexRingWAL, "restart must retain remote WAL mode");
    assert.equal((await reloaded.wal.snapshot()).sequence, 1, "remote WAL records must survive reinitialization");
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

test("remote queue index keeps claim, heartbeat, and completion off full job scans", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-remote-queue-index-"));
  try {
    const cas = new MemoryCAS();
    const store = new ApexPureStore({ root, cas });
    await store.init();
    await store.ensureRemoteQueueIndex();
    const baseline = cas.listCalls.get("jobs") || 0;
    const queued = await store.enqueue({ id: "indexed-job", type: "test.indexed", payload: { ok: true } });
    assert.equal(queued.durable, true);
    assert.equal((await cas.listRefs("queue")).some(ref => ref.value.id === "indexed-job"), true);
    assert.equal(cas.listCalls.get("jobs") || 0, baseline, "enqueue without dedupe must not scan every job");
    const claimed = await store.claim({ workerId: "index-test", limit: 1 });
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].id, "indexed-job");
    assert.equal((await cas.listRefs("running")).some(ref => ref.value.id === "indexed-job"), true);
    assert.equal(await store.transition("indexed-job", "heartbeat", {
      leaseToken: claimed[0].leaseToken, leaseFence: claimed[0].leaseFence, leaseMs: 60000
    }), true);
    assert.equal(await store.transition("indexed-job", "complete", {
      leaseToken: claimed[0].leaseToken, leaseFence: claimed[0].leaseFence, result: { ok: true }
    }), true);
    assert.equal((await cas.listRefs("running")).some(ref => ref.value.id === "indexed-job"), false);
    assert.equal(cas.listCalls.get("jobs") || 0, baseline, "claim and transitions must use targeted refs, not full job scans");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("remote dispatch dedupe uses an index and retains completed dispatch keys", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-remote-dedupe-index-"));
  try {
    const cas = new MemoryCAS();
    const store = new ApexPureStore({ root, cas });
    await store.init();
    await store.ensureRemoteQueueIndex();
    const baseline = cas.listCalls.get("jobs") || 0;
    const first = await store.enqueue({ id: "dispatch-first", type: "sovereign.app.dispatch", dedupeKey: "wave-index-test", payload: {} });
    assert.equal(first.durable, true);
    const claimed = await store.claim({ workerId: "dedupe-test", onlyId: "dispatch-first", limit: 1 });
    assert.equal(claimed.length, 1);
    assert.equal(await store.transition("dispatch-first", "complete", {
      leaseToken: claimed[0].leaseToken, leaseFence: claimed[0].leaseFence, result: { ok: true }
    }), true);
    const duplicate = await store.enqueue({ id: "dispatch-second", type: "sovereign.app.dispatch", dedupeKey: "wave-index-test", payload: {} });
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.id, "dispatch-first");
    assert.equal(duplicate.status, "completed");
    assert.equal(cas.listCalls.get("jobs") || 0, baseline, "dedupe must not scan the full job namespace");
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
