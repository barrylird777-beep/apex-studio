import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = source => spawnSync(process.execPath, ["--input-type=module", "-e", source], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, NODE_ENV: "production", APEX_CAS_REMOTE_ENABLED: "false" }
});

test("production ApexPureStore refuses local persistence fallback", () => {
  const result = run(`
    const { ApexPureStore } = await import("./src/core/apex-pure-store.mjs");
    new ApexPureStore();
  `);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires an explicitly injected peer-owned CAS adapter/);
});

test("production legacy WAL refuses initialization and writes before touching disk", () => {
  const result = run(`
    process.env.APEX_CAS_REMOTE_ENABLED = "true";
    const { ApexRingWAL } = await import("./src/core/apex-ring-wal.mjs");
    const wal = new ApexRingWAL({ file: "/tmp/apex-production-wal-must-not-be-created.jsonl" });
    await assert.rejects(wal.append("test.write", { marker: true }), /Local WAL is migration-only/);
  `);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("production rejects generic remote object storage even when the legacy remote flag is enabled", () => {
  const result = run(`
    process.env.APEX_CAS_REMOTE_ENABLED = "true";
    const { ApexPureStore } = await import("./src/core/apex-pure-store.mjs");
    const genericObjectStore = { init: async () => {}, readRef: async () => null, writeRef: async () => {}, listRefs: async () => [] };
    new ApexPureStore({ cas: genericObjectStore });
  `);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires an explicitly injected peer-owned CAS adapter/);
});

test("production accepts only an explicitly marked peer-owned adapter, not a flag-only configuration", () => {
  const result = run(`
    process.env.APEX_CAS_REMOTE_ENABLED = "true";
    const { ApexPureStore } = await import("./src/core/apex-pure-store.mjs");
    new ApexPureStore();
  `);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires an explicitly injected peer-owned CAS adapter/);
});
