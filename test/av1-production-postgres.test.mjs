import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("AV1 runtime uses the PostgreSQL durable worker and contains no SQLite persistence", () => {
  const daemon = read("src/workers/av1-production-daemon.mjs");
  const handler = read("src/workers/av1-production-handler.mjs");
  const combined = daemon + "\n" + handler;
  assert.match(daemon, /durable-worker-daemon\.mjs/);
  assert.match(daemon, /type:\s*"av1\.encode"/);
  assert.match(handler, /libsvtav1/);
  assert.doesNotMatch(combined, /sqlite3|\.sqlite\b|APEX_PRODUCTION_DB_FILE|APEX_OMNI_DB_FILE/);
});
