import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("legacy worker entry delegates to the sovereign Pure-WAL daemon", async () => {
  const source = await readFile(new URL("../src/workers/apex-2000-worker-daemon.mjs", import.meta.url), "utf8");
  assert.match(source, /apex-2000-worker-pure-wal-daemon\.mjs/);
  assert.doesNotMatch(source, /from\s+["']pg["']/);
  assert.doesNotMatch(source, /DATABASE_URL/);
});

test("production worker bootstrap uses authenticated remote worker settings without migrations", async () => {
  const source = await readFile(new URL("../scripts/bootstrap-production-worker.sh", import.meta.url), "utf8");
  assert.match(source, /APEX_WORKER_API_URL/);
  assert.match(source, /APEX_WORKER_TOKEN/);
  assert.doesNotMatch(source, /DATABASE_URL|db:migrate/);
});

test("environment template selects Pure-WAL and has no relational runtime defaults", async () => {
  const source = await readFile(new URL("../.env.example", import.meta.url), "utf8");
  assert.match(source, /APEX_SE_X_ROOT/);
  assert.match(source, /APEX_WAL_FILE/);
  assert.match(source, /APEX_WORKER_API_URL=/);
  assert.match(source, /APEX_WORKER_TOKEN=/);
  assert.doesNotMatch(source, /DATABASE_URL|APEX_PRODUCTION_DB_FILE|sqlite/i);
});

test("default worker entry fails closed instead of launching the retired AV1 daemon", async () => {
  const source = await readFile(new URL("../index.mjs", import.meta.url), "utf8");
  assert.match(source, /legacy SQLite AV1 daemon is retired/);
  assert.doesNotMatch(source, /import\(["']\.\/src\/workers\/av1-production-daemon\.mjs/);
});

test("development script starts the sovereign server instead of the legacy database API", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts.dev, "node --watch server.mjs");
});
