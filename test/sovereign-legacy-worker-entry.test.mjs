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
