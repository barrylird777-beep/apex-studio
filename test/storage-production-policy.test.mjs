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
  assert.match(result.stderr, /Production requires APEX_CAS_REMOTE_ENABLED=true/);
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

test("production package scripts do not expose PostgreSQL migration, studio, seed, or backup commands", () => {
  const result = run(`
    import fs from "node:fs/promises";
    const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
    for (const name of ["db:generate", "db:migrate", "db:studio", "db:seed", "db:migrate:workers", "db:migrate:postgres", "db:backup"]) {
      if (Object.hasOwn(pkg.scripts, name)) throw new Error("retired PostgreSQL command remains: " + name);
    }
  `);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
