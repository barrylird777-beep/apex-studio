import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { APEX_LIMITS } from "../src/core/mesh/apex-limits.mjs";
import { CAPACITY } from "../src/core/capacity.mjs";

test("production capacity has bounded worker and database budgets", () => {
  assert.equal(APEX_LIMITS.INFRASTRUCTURE.DATABASE, "PostgreSQL");
  assert.ok(APEX_LIMITS.WORKER.CONCURRENCY <= APEX_LIMITS.WORKER.MAX_CONCURRENCY);
  assert.ok(APEX_LIMITS.WORKER.BATCH_SIZE <= APEX_LIMITS.WORKER.MAX_BATCH_SIZE);
  assert.ok(APEX_LIMITS.WORKER.DB_POOL_DEFAULT <= APEX_LIMITS.WORKER.DB_POOL_MAX);
  assert.ok(APEX_LIMITS.WORKER.MAX_CONCURRENCY <= 64);
  assert.ok(APEX_LIMITS.WORKER.MAX_BATCH_SIZE <= APEX_LIMITS.WORKER.MAX_CONCURRENCY);
  assert.ok(CAPACITY.jobConcurrency <= APEX_LIMITS.WORKER.MAX_CONCURRENCY);
  assert.equal(CAPACITY.omniBackend, undefined);
});

test("durable worker store uses the canonical PostgreSQL pool", () => {
  const source = fs.readFileSync(new URL("../src/core/mesh/durable-worker-store.mjs", import.meta.url), "utf8");
  assert.match(source, /import \{ pool as dbPool \} from ["']\.\.\/\.\.\/db\/index\.ts["'];/);
  assert.doesNotMatch(source, /from ["']pg["']/);
  assert.doesNotMatch(source, /new Pool\(/);
});

test("capacity has no SQLite durable fallback", () => {
  assert.equal("sqlite" in CAPACITY, false);
  assert.equal("omniDatabase" in CAPACITY, false);
  assert.equal(CAPACITY.storageBackend, "object-store");
});
