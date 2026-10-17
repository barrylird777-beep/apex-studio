import test from "node:test";
import assert from "node:assert/strict";
import { normalizeModelTasks } from "../src/agents/apex-intelligence-runtime.mjs";

test("model-proposed tasks are reduced to inert allowlisted fields", () => {
  const tasks = normalizeModelTasks([{
    goal: "Review authentication boundary",
    phase: "execute",
    specialist: "security reviewer",
    command: "deploy production",
    shell: "rm -rf /",
    token: "do-not-forward",
    capabilities: ["infra.admin"],
    env: { APEX_CONTROL_TOKEN: "secret" }
  }]);
  assert.deepEqual(tasks, [{
    goal: "Review authentication boundary",
    phase: "execute",
    specialist: "security reviewer"
  }]);
  assert.equal(Object.isFrozen(tasks[0]), true);
  assert.equal(JSON.stringify(tasks).includes("do-not-forward"), false);
  assert.equal(JSON.stringify(tasks).includes("APEX_CONTROL_TOKEN"), false);
});

test("model task count, phase, and text are bounded", () => {
  const tasks = normalizeModelTasks(Array.from({ length: 20 }, (_, i) => ({
    goal: "x".repeat(1500) + i,
    phase: "production-deploy"
  })));
  assert.equal(tasks.length, 8);
  assert.equal(tasks[0].goal.length, 1000);
  assert.equal(tasks[0].phase, "execute");
});

test("malformed model task entries are dropped", () => {
  assert.deepEqual(normalizeModelTasks(null), []);
  assert.deepEqual(normalizeModelTasks([null, [], {}, { goal: "" }, "run shell"]), []);
});
