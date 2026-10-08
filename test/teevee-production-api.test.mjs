import assert from "node:assert/strict";
import test from "node:test";
import { createTeeVeeProductionRouter } from "../src/api/teevee-production-api.mjs";

test("TeeVee production API requires durable enqueue", () => {
  assert.throws(() => createTeeVeeProductionRouter(), /TeeVee production enqueue function is required/);
});

test("TeeVee production API factory mounts routes", () => {
  const router=createTeeVeeProductionRouter({enqueue:async payload=>({id:"job-1",payload})});
  assert.equal(typeof router,"function");
  assert.ok(Array.isArray(router.stack));
  assert.ok(router.stack.some(layer=>layer.route?.path==="/status"));
  assert.ok(router.stack.some(layer=>layer.route?.path==="/start"));
});
