import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, access, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ContentAddressedStore } from "../src/core/content-addressed-store.mjs";
import { ApexPureStore } from "../src/core/apex-pure-store.mjs";
import { ApexRingWAL } from "../src/core/apex-ring-wal.mjs";

test("coordinator-local CAS object writes are disabled", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-disabled-cas-"));
  try {
    const store = new ContentAddressedStore({ root });
    await assert.rejects(store.putObject({ value: 7 }), error => error.code === "NONCOMPLIANT_STORAGE_DISABLED");
    await assert.rejects(store.writeRef("app", "record-1", { revision: 1 }),
      error => error.code === "NONCOMPLIANT_STORAGE_DISABLED");
    await assert.rejects(store.deleteRef("app", "record-1"),
      error => error.code === "NONCOMPLIANT_STORAGE_DISABLED");
    assert.deepEqual(await readdir(root), [], "disabled writes must not create local CAS directories");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("PureStore fails closed without a canonical peer namespace and creates no local store", async () => {
  const root = path.join(os.tmpdir(), "apex-unscoped-store-" + process.pid + "-" + Date.now());
  const store = new ApexPureStore({ root });
  await assert.rejects(store.init(), /APEX_APP_NAMESPACE is required/);
  await assert.rejects(access(root), { code: "ENOENT" });
});

test("PureStore rejects a coordinator-local CAS even when passed explicitly", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-local-cas-injection-"));
  try {
    const local = new ContentAddressedStore({ root: path.join(root, "local-cas") });
    const store = new ApexPureStore({ root: path.join(root, "projects"), cas: local });
    await assert.rejects(store.init(), /canonical, app-scoped peer CAS adapter is required/);
    await assert.rejects(access(path.join(root, "projects")), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("PureStore does not replay a coordinator-local WAL during peer-only startup", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-no-local-wal-import-"));
  try {
    const wal = new ApexRingWAL({ file: path.join(root, "wal", "legacy.jsonl") });
    await wal.append("state.put", { collection: "records", id: "legacy", record: { value: 7 } });
    const before = await wal.snapshot();
    const store = new ApexPureStore({ root: path.join(root, "projects"), wal });
    await assert.rejects(store.init(), /APEX_APP_NAMESPACE is required/);
    const after = await wal.snapshot();
    assert.equal(after.sequence, before.sequence);
    assert.equal(after.ring.length, before.ring.length);
    await assert.rejects(access(path.join(root, "projects")), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
