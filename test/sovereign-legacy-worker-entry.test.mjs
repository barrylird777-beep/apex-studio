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
