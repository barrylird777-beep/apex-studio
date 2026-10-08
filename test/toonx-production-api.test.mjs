import assert from "node:assert/strict";
import test from "node:test";
import { createTOONXProductionRouter } from "../src/api/toonx-production-api.mjs";

test("TOONX production API requires durable enqueue", () => {
  assert.throws(() => createTOONXProductionRouter(), /TOONX production enqueue function is required/);
});

test("TOONX production API factory mounts routes", () => {
  const router=createTOONXProductionRouter({enqueue:async payload=>({id:"job-1",payload})});
  assert.equal(typeof router,"function");
  assert.ok(Array.isArray(router.stack));
  assert.ok(router.stack.some(layer=>layer.route?.path==="/status"));
  assert.ok(router.stack.some(layer=>layer.route?.path==="/start"));
});
