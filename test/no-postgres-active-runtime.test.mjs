import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = relative => readFile(new URL(relative, import.meta.url), "utf8");

test("production entrypoints and active handlers do not depend on PostgreSQL", async () => {
  const paths = [
    "../index.mjs",
    "../server.mjs",
    "../scripts/start-apex-stack.mjs",
    "../src/core/sovereign-runtime-daemon.mjs",
    "../src/core/mesh/durable-worker-store.mjs",
    "../src/workers/voiceover-worker.mjs",
    "../src/jobs/teevee-handlers.mjs",
    "../src/jobs/production-handlers.mjs"
  ];
  for (const path of paths) {
    const source = await read(path);
    assert.doesNotMatch(source, /from\s+["']pg["']/i, path + " imports pg");
    assert.doesNotMatch(source, /DATABASE_URL|new\s+Pool\s*\(|pg\.Pool/i, path + " depends on PostgreSQL");
  }
});
