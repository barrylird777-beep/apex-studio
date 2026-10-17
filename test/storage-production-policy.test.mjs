import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (source, nodeEnv = "production") => spawnSync(process.execPath, ["--input-type=module", "-e", source], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, NODE_ENV: nodeEnv, APEX_CAS_REMOTE_ENABLED: "false" }
});

const runConstructorPolicy = source => run(`
  const module = await import("./src/core/apex-pure-store.mjs");
  process.env.NODE_ENV = "production";
  ${source}
`, "test");

test("production ApexPureStore defers missing peer storage failure until initialization", () => {
  const result = runConstructorPolicy(`
    const { ApexPureStore } = module;
    const store = new ApexPureStore();
    await assert.rejects(store.init(), /requires an actual PeerMeshCasAdapter backed by PeerContentAddressedStore/);
  `);
  assert.equal(result.status, 0, result.stderr || result.stdout);
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
  const result = runConstructorPolicy(`
    process.env.APEX_CAS_REMOTE_ENABLED = "true";
    const { ApexPureStore } = module;
    const genericObjectStore = { init: async () => {}, readRef: async () => null, writeRef: async () => {}, listRefs: async () => [] };
    const store = new ApexPureStore({ cas: genericObjectStore });
    await assert.rejects(store.init(), /requires an actual PeerMeshCasAdapter backed by PeerContentAddressedStore/);
  `);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("production accepts only an explicitly marked peer-owned adapter, not a flag-only configuration", () => {
  const result = runConstructorPolicy(`
    process.env.APEX_CAS_REMOTE_ENABLED = "true";
    const { ApexPureStore } = module;
    const store = new ApexPureStore();
    await assert.rejects(store.init(), /requires an actual PeerMeshCasAdapter backed by PeerContentAddressedStore/);
  `);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("production rejects a duck-typed adapter that forges the peer-owned marker", () => {
  const result = runConstructorPolicy(`
    process.env.APEX_CAS_REMOTE_ENABLED = "true";
    const { ApexPureStore } = module;
    const forged = { peerOwnedStorage: true, init: async () => {}, readRef: async () => null, writeRef: async () => {}, listRefs: async () => [] };
    const store = new ApexPureStore({ cas: forged });
    await assert.rejects(store.init(), /requires an actual PeerMeshCasAdapter backed by PeerContentAddressedStore/);
  `);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("PeerMeshCasAdapter refuses duck-typed stores that are not PeerContentAddressedStore instances", () => {
  const result = run(`
    const { PeerMeshCasAdapter } = await import("./src/core/peer-mesh-cas-adapter.mjs");
    const forgedStore = { readRef: async () => null, writeRef: async () => {}, listRefs: async () => [] };
    new PeerMeshCasAdapter({ store: forgedStore, appNamespace: "PlanetApeX" });
  `);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires an actual PeerContentAddressedStore instance/);
});
