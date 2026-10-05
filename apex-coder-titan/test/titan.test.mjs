import test from "node:test";
import assert from "node:assert/strict";
import { config, validateConfig } from "../src/config.mjs";

test("Titan defaults are bounded and explicit", () => {
  assert.equal(config.maxDepth, 2);
  assert.equal(config.implementationRounds, 72);
  assert.equal(config.repairPasses, 7);
  assert.equal(config.repairTurns, 20);
});

test("configuration reports missing API key without crashing", () => {
  if (!process.env.OPENAI_API_KEY) {
    assert.deepEqual(validateConfig(), { ok: false, error: "OPENAI_API_KEY is not configured." });
  }
});
