import test from "node:test";
import assert from "node:assert/strict";
import { normalizeModelTasks, sanitizePromptValue, safePromptJson } from "../src/agents/apex-intelligence-runtime.mjs";

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

import { ApexIntelligence } from "../src/agents/apex-intelligence.mjs";

test("core orchestration strips model-supplied capabilities before custom parallel executors", async () => {
  let received;
  const runtime = new ApexIntelligence({
    executor: async () => ({ status: "blocked" }),
    verifier: async () => ({ verified: false }),
    parallelExecutor: async tasks => {
      received = tasks;
      return { status: "progress", outputs: [] };
    }
  });
  await runtime.runParallel([{
    goal: "Inspect token handling",
    phase: "execute",
    command: "deploy",
    shell: "cat .env",
    env: { APEX_CONTROL_TOKEN: "secret" },
    capabilities: ["infra.admin"]
  }]);
  assert.deepEqual(received, [{ goal: "Inspect token handling", phase: "execute" }]);
  assert.equal(JSON.stringify(received).includes("APEX_CONTROL_TOKEN"), false);
});

test("AI prompt context redacts credential fields recursively and bounds input", () => {
  const cleaned = sanitizePromptValue({
    accessToken: "super-secret-token",
    nested: { clientSecret: "client-secret-value", harmless: "visible" },
    notes: "Authorization: Bearer abc.def.ghi and api_key=inline-secret-value",
    huge: "x".repeat(3000)
  });
  const serialized = JSON.stringify(cleaned);
  assert.equal(serialized.includes("super-secret-token"), false);
  assert.equal(serialized.includes("client-secret-value"), false);
  assert.equal(serialized.includes("inline-secret-value"), false);
  assert.equal(serialized.includes("abc.def.ghi"), false);
  assert.equal(cleaned.nested.harmless, "visible");
  assert.ok(cleaned.huge.length <= 1200);
  assert.ok(safePromptJson({ data: "x".repeat(10000) }).length <= 6010);
});

test("AI prompt context marks secrets in private keys and common token formats", () => {
  const cleaned = safePromptJson({
    privateKey: "-----BEGIN RSA PRIVATE KEY-----\\nprivate-material\\n-----END RSA PRIVATE KEY-----",
    token: "ghp_abcdefghijklmnopqrstuvwxyz1234567890"
  });
  assert.equal(cleaned.includes("private-material"), false);
  assert.equal(cleaned.includes("ghp_abcdefghijklmnopqrstuvwxyz1234567890"), false);
});
