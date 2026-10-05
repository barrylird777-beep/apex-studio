import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.mjs";

test("Titan defaults favor the free fast swarm", () => {
  assert.equal(config.maxDepth, 2);
  assert.equal(config.implementationRounds, 12);
  assert.equal(config.repairPasses, 2);
  assert.equal(config.repairTurns, 6);
  assert.equal(config.auditConcurrency, 3);
  assert.equal(config.model, "openai/gpt-oss-120b");
  assert.equal(config.geminiModel, "gemini-3.8-flash");
  assert.equal(config.reasoningEffort, "high");
});
