import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../src/jobs/production-handlers.mjs";

test("durable permanent-health jobs execute a real health handler", async () => {
  assert.equal(typeof handlers["permanent-health"], "function");
  const result = await handlers["permanent-health"]({
    id: "permanent-health-test",
    payload: {
      workerId: "worker-test",
      role: "general",
      task: "queue reliability validation"
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.workerId, "worker-test");
  assert.equal(result.role, "general");
  assert.equal(result.task, "queue reliability validation");
  assert.ok(Number.isFinite(result.durationMs));
  assert.ok(Number.isFinite(Date.parse(result.completedAt)));
});
