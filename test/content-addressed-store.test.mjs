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


test("concurrent store instances perform legacy migration only once", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-cas-single-migration-"));
  try {
    const walFile = path.join(root, "wal", "legacy.jsonl");
    const seed = new ApexRingWAL({ file: walFile });
    await seed.append("state.put", {
      collection: "kash-korner",
      id: "legacy-opportunity",
      record: { value: 7 }
    });
    let replayCalls = 0;
    const makeWal = () => {
      const wal = new ApexRingWAL({ file: walFile });
      const replay = wal.replay.bind(wal);
      wal.replay = async options => {
        replayCalls += 1;
        await new Promise(resolve => setTimeout(resolve, 25));
        return replay(options);
      };
      return wal;
    };
    const first = new ApexPureStore({ root, wal: makeWal() });
    const second = new ApexPureStore({ root, wal: makeWal() });
    await Promise.all([first.init(), second.init(), first.init()]);
    assert.equal(replayCalls, 1, "shared volume migration must run once across store instances");
    assert.equal((await first.get("kash-korner", "legacy-opportunity")).value, 7);
    assert.equal((await second.get("kash-korner", "legacy-opportunity")).value, 7);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("legacy migration streams batches and preserves final state and job transitions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-cas-stream-migration-"));
  try {
    const walFile = path.join(root, "wal", "legacy.jsonl");
    const wal = new ApexRingWAL({ file: walFile });
    await wal.append("job.enqueue", { id: "job-stream-1", job: { id: "job-stream-1", status: "queued", attempts: 0 } });
    await wal.append("job.transition", { id: "job-stream-1", patch: { status: "done", attempts: 1 } });
    await wal.append("state.put", { collection: "kash-korner", id: "deleted-row", record: { value: "old" } });
    await wal.append("state.delete", { collection: "kash-korner", id: "deleted-row" });
    for (let i = 0; i < 260; i += 1) {
      await wal.append("state.put", { collection: "kash-korner", id: "row-" + i, record: { value: i } });
    }

    const store = new ApexPureStore({ root: path.join(root, "projects"), wal });
    await store.init();
    assert.equal((await store.get("kash-korner", "row-259")).value, 259);
    assert.equal(await store.get("kash-korner", "deleted-row"), null);
    await store.refreshJobs();
    const job = store.jobs().find(item => item.id === "job-stream-1");
    assert.equal(job.status, "done");
    assert.equal(job.attempts, 1);
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
