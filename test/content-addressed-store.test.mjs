import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir, mkdir, writeFile, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ContentAddressedStore } from "../src/core/content-addressed-store.mjs";
import { ApexPureStore } from "../src/core/apex-pure-store.mjs";
import { ApexRingWAL } from "../src/core/apex-ring-wal.mjs";
import { RemoteCasObjectBackend } from "../src/core/remote-cas-object-backend.mjs";

test("content-addressed objects verify hashes and round-trip", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-cas-"));
  try {
    const store = await new ContentAddressedStore({ root }).init();
    const object = await store.putObject({ value: 7, nested: ["safe"] });
    assert.match(object.hash, /^[a-f0-9]{64}$/);
    assert.deepEqual(await store.getObject(object.hash), { value: 7, nested: ["safe"] });
    assert.equal((await store.putObject({ value: 7, nested: ["safe"] })).hash, object.hash);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("manifest updates are atomic and compare-and-swap guarded", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-cas-"));
  try {
    const store = await new ContentAddressedStore({ root }).init();
    const first = await store.writeRef("app", "record-1", { revision: 1 });
    assert.deepEqual((await store.readRef("app", "record-1")).value, { revision: 1 });
    await assert.rejects(
      store.writeRef("app", "record-1", { revision: 2 }, { expectedHash: "0".repeat(64) }),
      error => error.code === "CAS_CONFLICT"
    );
    const second = await store.writeRef("app", "record-1", { revision: 2 }, { expectedHash: first.hash });
    assert.notEqual(second.hash, first.hash);
    assert.deepEqual((await store.readRef("app", "record-1")).value, { revision: 2 });
    assert.equal(await store.deleteRef("app", "record-1", { expectedHash: second.hash }), true);
    assert.equal(await store.readRef("app", "record-1"), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("content-addressed storage does not create an append log", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-cas-"));
  try {
    const store = await new ContentAddressedStore({ root }).init();
    await store.writeRef("app", "one", { ok: true });
    const names = await readdir(root);
    assert.deepEqual(names.sort(), ["objects", "refs"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("content-addressed manifests recover an abandoned stale lock", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-cas-lock-"));
  try {
    const store = await new ContentAddressedStore({ root }).init();
    const dir = path.join(root, "refs", "app");
    await mkdir(dir, { recursive: true });
    const lock = path.join(dir, "record-1.json.lock");
    await writeFile(lock, JSON.stringify({ pid: 99999999, createdAt: 1, token: "abandoned" }));
    const stale = new Date(Date.now() - 60000);
    await utimes(lock, stale, stale);
    await store.writeRef("app", "record-1", { recovered: true });
    assert.deepEqual((await store.readRef("app", "record-1")).value, { recovered: true });
    assert.equal(await readFile(lock, "utf8").then(() => true, error => error.code === "ENOENT"), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("record writes avoid a full store refresh on every opportunity insert", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-cas-write-fast-"));
  try {
    const store = new ApexPureStore({
      root,
      wal: new ApexRingWAL({ file: path.join(root, "wal", "legacy.jsonl") })
    });
    await store.init();
    let refreshCalls = 0;
    const refresh = store.refresh.bind(store);
    store.refresh = async () => { refreshCalls += 1; return refresh(); };
    await store.put("kash-korner", "opportunity-1", { value: 1 });
    assert.equal(refreshCalls, 0);
    const saved = await store.cas.readRef("state", store.refKey("kash-korner", "opportunity-1"));
    assert.equal(saved.value.record.value, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("active storage never replays legacy WAL during startup", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-cas-no-wal-replay-"));
  try {
    const walFile = path.join(root, "wal", "legacy.jsonl");
    const seed = new ApexRingWAL({ file: walFile });
    await seed.append("state.put", {
      collection: "kash-korner",
      id: "legacy-opportunity",
      record: { value: 7 }
    });
    let replayCalls = 0;
    const wal = new ApexRingWAL({ file: walFile });
    wal.replay = async () => { replayCalls += 1; throw new Error("legacy WAL replay must never run"); };
    const first = new ApexPureStore({ root, wal });
    const second = new ApexPureStore({ root, wal });
    await Promise.all([first.init(), second.init(), first.init()]);
    assert.equal(replayCalls, 0, "active startup must not read or replay legacy WAL");
    assert.equal(await first.get("kash-korner", "legacy-opportunity"), null);
    assert.equal(await second.get("kash-korner", "legacy-opportunity"), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("active storage ignores legacy WAL job transitions and state records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-cas-no-wal-migration-"));
  try {
    const walFile = path.join(root, "wal", "legacy.jsonl");
    const wal = new ApexRingWAL({ file: walFile });
    await wal.append("job.enqueue", { id: "job-stream-1", job: { id: "job-stream-1", status: "queued", attempts: 0 } });
    await wal.append("job.transition", { id: "job-stream-1", patch: { status: "done", attempts: 1 } });
    await wal.append("state.put", { collection: "kash-korner", id: "legacy-row", record: { value: 259 } });
    const store = new ApexPureStore({ root: path.join(root, "projects"), wal });
    await store.init();
    assert.equal(await store.get("kash-korner", "legacy-row"), null);
    await store.refreshJobs();
    assert.equal(store.jobs().some(item => item.id === "job-stream-1"), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("remote CAS backend stays disabled unless every storage credential is configured", async () => {
  const backend = new RemoteCasObjectBackend({});
  assert.equal(backend.enabled, false);
  assert.equal(await backend.put("a".repeat(64), "{}"), false);
  assert.equal(await backend.get("a".repeat(64)), null);
  assert.equal(backend.key("a".repeat(64)), "apex-cas/objects/sha256/aa/" + "a".repeat(64) + ".json");
  assert.throws(() => backend.key("../escape"), /Invalid SHA-256 object id/);
});

test("remote-only CAS writes and reads objects and refs without local fallback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-cas-remote-only-"));
  try {
    const store = new ContentAddressedStore({ root });
    const objects = new Map();
    const refs = new Map();
    store.remoteObjects = {
      enabled: true,
      async put(hash, bytes) { objects.set(hash, bytes); return true; },
      async get(hash) { return objects.get(hash) ?? null; },
      async putRef(ns, key, value) { refs.set(ns + "/" + key, value); return true; },
      async getRef(ns, key) { return refs.get(ns + "/" + key) ?? null; },
      async listRefs(ns) { return [...refs.keys()].filter(k => k.startsWith(ns + "/")).map(k => k.slice(ns.length + 1)); },
      async deleteRef(ns, key) { refs.delete(ns + "/" + key); return true; }
    };
    store.remoteRefsEnabled = true;
    await store.init();
    const written = await store.writeRef("app", "preserved-record", { marker: "cloud-round-trip", revision: 1 });
    assert.equal(written.backend, "object-storage");
    assert.deepEqual((await store.readRef("app", "preserved-record")).value, { marker: "cloud-round-trip", revision: 1 });
    assert.deepEqual(await store.listRefs("app").then(rows => rows.map(row => row.key)), ["preserved-record"]);
    assert.deepEqual(await readdir(root), []);
    assert.equal(await store.deleteRef("app", "preserved-record", { expectedHash: written.hash }), true);
    assert.equal(await store.readRef("app", "preserved-record"), null);
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("remote-only CAS fails closed when a referenced cloud object is missing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-cas-remote-missing-"));
  try {
    const store = new ContentAddressedStore({ root });
    store.remoteObjects = {
      enabled: true,
      async get() { return null; },
      async getRef() { return JSON.stringify({ version: 1, namespace: "app", key: "lost", hash: "a".repeat(64) }); }
    };
    store.remoteRefsEnabled = true;
    await store.init();
    await assert.rejects(store.readRef("app", "lost"), /Remote content-addressed object is missing/);
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("remote-only CAS configuration fails closed when production credentials are incomplete", () => {
  assert.throws(() => new RemoteCasObjectBackend({ NODE_ENV: "production" }), /remote-only CAS is required/i);
  assert.throws(() => new RemoteCasObjectBackend({ APEX_CAS_REMOTE_ENABLED: "true", APEX_OBJECT_STORAGE_BUCKET: "bucket" }), /remote-only CAS is required/i);
});

test("remote-only CAS refuses production startup until preservation migration is verified", () => {
  const env = {
    NODE_ENV: "production",
    APEX_CAS_REMOTE_ENABLED: "true",
    APEX_OBJECT_STORAGE_ENDPOINT: "https://objects.example.invalid",
    APEX_OBJECT_STORAGE_BUCKET: "apex-test",
    APEX_OBJECT_STORAGE_REGION: "auto",
    APEX_OBJECT_STORAGE_ACCESS_KEY_ID: "test-access-key",
    APEX_OBJECT_STORAGE_SECRET_ACCESS_KEY: "test-secret-key"
  };
  assert.throws(() => new RemoteCasObjectBackend(env), /migration is not verified/i);
  assert.equal(new RemoteCasObjectBackend({ ...env, APEX_CAS_REMOTE_MIGRATION_VERIFIED: "true" }).enabled, true);
});
