import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { ApexPureStore } from "../src/core/apex-pure-store.mjs";
import { ApexRingWAL } from "../src/core/apex-ring-wal.mjs";
import { RemoteApexRingWAL } from "../src/core/remote-apex-ring-wal.mjs";

const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
class MemoryCAS {
  constructor() { this.namespace = 'KernelVision'; this.refs = new Map(); this.listCalls = new Map(); }
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

test("remote Pure Store writes directly to CAS without an active WAL or local record mirrors", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-remote-store-"));
  try {
    const cas = new MemoryCAS();
    const store = new ApexPureStore({ root, wal: new ApexRingWAL({ file: path.join(root, "wal", "ring.wal.jsonl") }), cas });
    await store.init();
    assert.ok(store.wal instanceof ApexRingWAL, "the legacy WAL remains migration-only");
    const durable = await store.put("app_records", "no-wal-proof", { durable: true });
    assert.equal(durable.id, "no-wal-proof");
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
    assert.equal((await cas.listRefs("wal")).length, 0, "active state/job writes must not create remote WAL records");
    assert.equal(await store.delete("app_records", "record-1"), true);
    assert.equal(await store.get("app_records", "record-1"), null);
    const reloaded = new ApexPureStore({ root, wal: new ApexRingWAL({ file: path.join(root, "wal", "ring.wal.jsonl") }), cas });
    await reloaded.init();
    assert.deepEqual(await reloaded.get("app_records", "no-wal-proof"), durable, "CAS records survive store reinitialization");
    assert.equal((await cas.listRefs("wal")).length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("remote WAL does not inherit the legacy local byte-cap holdback", async () => {
  const cas = new MemoryCAS();
  const wal = new RemoteApexRingWAL({ cas, scope: "no-cap-test", maxBytes: 1 });
  const record = await wal.append("proof.over-cap", { durable: true });
  assert.equal(record.seq, 1);
  assert.equal((await wal.snapshot()).sequence, 1);
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

test("remote active-job indexes are committed before queued/running job state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-remote-index-first-"));
  try {
    const cas = new MemoryCAS();
    const store = new ApexPureStore({ root, cas });
    await store.init();
    await store.ensureRemoteQueueIndex();
    const writeRef = cas.writeRef.bind(cas);
    cas.writeRef = async (namespace, key, value, options) => {
      if (namespace === "jobs" && value?.job?.id === "index-before-state") {
        const indexNamespace = value.job.status === "queued" ? "queue" : value.job.status === "running" ? "running" : null;
        if (indexNamespace) assert.ok(await cas.readRef(indexNamespace, key), indexNamespace + " index must exist before job state is committed");
      }
      return writeRef(namespace, key, value, options);
    };
    await store.enqueue({ id: "index-before-state", type: "test.index-first", payload: {} });
    const claimed = await store.claim({ workerId: "index-first-test", limit: 1 });
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].id, "index-before-state");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("remote queue listing does not hold the global mutation lease", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-remote-queue-lock-scope-"));
  try {
    const cas = new MemoryCAS();
    const store = new ApexPureStore({ root, cas });
    await store.init();
    await store.ensureRemoteQueueIndex();
    await store.enqueue({ id: "scan-lock-job", type: "test.lock-scope", payload: {} });

    const listRefs = cas.listRefs.bind(cas);
    let releaseScan;
    let signalScan;
    const scanStarted = new Promise(resolve => { signalScan = resolve; });
    const scanGate = new Promise(resolve => { releaseScan = resolve; });
    cas.listRefs = async namespace => {
      if (namespace === "queue") {
        signalScan();
        await scanGate;
      }
      return listRefs(namespace);
    };

    const claimPromise = store.claim({ workerId: "lock-scope-test", limit: 1 });
    await scanStarted;
    assert.equal(cas.refs.has("system/queue-mutations"), false, "queue listing must happen before the global mutation lease is acquired");
    releaseScan();
    const claimed = await claimPromise;
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].id, "scan-lock-job");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("expired-running index listing does not hold the global mutation lease", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-remote-running-lock-scope-"));
  try {
    const cas = new MemoryCAS();
    const store = new ApexPureStore({ root, cas });
    await store.init();
    await store.ensureRemoteQueueIndex();
    await store.enqueue({ id: "expired-lock-job", type: "test.lock-scope", payload: {} });
    await store.claim({ workerId: "lock-scope-test", limit: 1, leaseMs: 1000 });

    const jobKey = store.refKey("job", "expired-lock-job");
    const jobRef = await cas.readRef("jobs", jobKey);
    await cas.writeRef("jobs", jobKey, { ...jobRef.value, job: { ...jobRef.value.job, leaseExpiresAt: 0 } }, { expectedHash: jobRef.hash });
    const runningRef = await cas.readRef("running", jobKey);
    await cas.writeRef("running", jobKey, { ...runningRef.value, leaseExpiresAt: 0 }, { expectedHash: runningRef.hash });

    const listRefs = cas.listRefs.bind(cas);
    let releaseScan;
    let signalScan;
    const scanStarted = new Promise(resolve => { signalScan = resolve; });
    const scanGate = new Promise(resolve => { releaseScan = resolve; });
    cas.listRefs = async namespace => {
      if (namespace === "running") {
        signalScan();
        await scanGate;
      }
      return listRefs(namespace);
    };

    const recoverPromise = store.recoverExpired(1);
    await scanStarted;
    assert.equal(cas.refs.has("system/queue-mutations"), false, "running-index listing must happen before the global mutation lease is acquired");
    releaseScan();
    assert.equal(await recoverPromise, 1);
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

test("remote queue indexes recover from a crash after job persistence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-remote-queue-recovery-"));
  try {
    const cas = new MemoryCAS();
    const first = new ApexPureStore({ root, cas });
    await first.init();
    await first.ensureRemoteQueueIndex();
    const queued = await first.enqueue({ id: "crash-window-job", type: "test.recover", payload: {} });
    assert.equal(queued.durable, true);
    const queueKey = first.refKey("job", "crash-window-job");
    const index = await cas.readRef("queue", queueKey);
    assert.ok(index, "enqueue creates the queue index");
    await cas.deleteRef("queue", queueKey, { expectedHash: index.hash });

    const restarted = new ApexPureStore({ root, cas });
    await restarted.init();
    await restarted.ensureRemoteQueueIndex({ force: true });
    const claimed = await restarted.claim({ workerId: "recovery-test", limit: 1 });
    assert.equal(claimed.length, 1, "startup reconciliation must rebuild a missing index even when an old marker exists");
    assert.equal(claimed[0].id, "crash-window-job");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("peer-only startup refuses to import coordinator-local CAS records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-remote-migration-"));
  try {
    const localCas = (await import("../src/core/content-addressed-store.mjs")).ContentAddressedStore;
    const source = await new localCas({ root: path.join(root, ".apex-cas") }).init();
    const sourceRef = await source.writeRef("state", "legacy-key", { collection: "legacy", id: "record-7", record: { id: "record-7", keep: true } });
    const remote = new MemoryCAS();
    const store = new ApexPureStore({ root, wal: new ApexRingWAL({ file: path.join(root, "wal", "ring.wal.jsonl") }), cas: remote });
    await store.init();
    assert.equal(await remote.readRef("state", store.refKey("legacy", "record-7")), null,
      "peer-only startup must not import coordinator-local records");
    assert.deepEqual((await source.readRef("state", "legacy-key")).value.record, { id: "record-7", keep: true },
      "the source remains untouched for explicit operator recovery");
    assert.ok(sourceRef.hash);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("peer-only startup never replays a coordinator-local WAL", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-remote-wal-readonly-"));
  try {
    const wal = new ApexRingWAL({ file: path.join(root, "wal", "ring.wal.jsonl") });
    await wal.append("state.put", { collection: "legacy", id: "wal-record", record: { id: "wal-record", fromWal: true } });
    wal._acquireLock = async () => { throw new Error("peer-only startup must not acquire a local WAL lock"); };
    const before = await readFile(wal.file, "utf8");
    const remote = new MemoryCAS();
    const store = new ApexPureStore({ root, wal, cas: remote });
    await store.init();
    const imported = await remote.readRef("state", store.refKey("legacy", "wal-record"));
    assert.equal(imported, null, "peer-only startup must not replay local WAL records");
    assert.equal(await readFile(wal.file, "utf8"), before, "the source WAL remains untouched");
  } finally { await rm(root, { recursive: true, force: true }); }
});
