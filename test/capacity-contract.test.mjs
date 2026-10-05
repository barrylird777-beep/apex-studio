import test from "node:test";
import assert from "node:assert/strict";
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

test("capacity has no SQLite durable fallback", () => {
  assert.equal("sqlite" in CAPACITY, false);
  assert.equal("omniDatabase" in CAPACITY, false);
  assert.equal(CAPACITY.storageBackend, "object-store");
});
