import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("legacy 2000-worker entry delegates to Pure-WAL without PostgreSQL", async () => {
  const source = await readFile(new URL("../src/workers/apex-2000-worker-daemon.mjs", import.meta.url), "utf8");
  assert.match(source, /apex-2000-worker-pure-wal-daemon\.mjs/);
  assert.doesNotMatch(source, /from\s+["']pg["']/);
  assert.doesNotMatch(source, /DATABASE_URL/);
  assert.match(source, /runApexPureWalWorkerDaemon/);
});

test("production worker bootstrap uses the authenticated Pure-WAL API and never runs database migrations", async () => {
  const source = await readFile(new URL("../scripts/bootstrap-production-worker.sh", import.meta.url), "utf8");
  assert.match(source, /APEX_WORKER_API_URL/);
  assert.match(source, /APEX_WORKER_TOKEN/);
  assert.doesNotMatch(source, /DATABASE_URL/);
  assert.doesNotMatch(source, /db:migrate/);
  assert.match(source, /Pure-WAL remote queue/);
});

test("environment template is sovereign and does not restore SQLite or obsolete channel branding", async () => {
  const source = await readFile(new URL("../.env.example", import.meta.url), "utf8");
  assert.match(source, /APEX_SE_X_ROOT/);
  assert.match(source, /APEX_WAL_FILE/);
  assert.match(source, /APEX_WORKER_API_URL=/);
  assert.match(source, /APEX_WORKER_TOKEN=/);
  assert.doesNotMatch(source, /DATABASE_URL|APEX_PRODUCTION_DB_FILE|sqlite/i);
  assert.doesNotMatch(source, /BIBLICALLYUNSEEN/i);
});

test("default index startup fails closed instead of launching the retired SQLite AV1 daemon", async () => {
  const source = await readFile(new URL("../index.mjs", import.meta.url), "utf8");
  assert.match(source, /The legacy SQLite AV1 daemon is retired/);
  assert.doesNotMatch(source, /import\(["']\.\/src\/workers\/av1-production-daemon\.mjs/);
});
