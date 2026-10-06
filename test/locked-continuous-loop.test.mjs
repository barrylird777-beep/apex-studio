import test from "node:test";
import assert from "node:assert/strict";

import {
  zeroCostAiProvider,
  buildAutonomousAiTask,
  continuousAiStatus
} from "../src/core/autonomy/locked-continuous-loop.mjs";

test("zero-cost AI is fail-closed by default", () => {
  const previous = {
    free: process.env.APEX_FREE_MODE,
    openrouter: process.env.OPENROUTER_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    confirmed: process.env.APEX_GEMINI_FREE_TIER_CONFIRMED
  };

  delete process.env.OPENROUTER_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.APEX_GEMINI_FREE_TIER_CONFIRMED;
  process.env.APEX_FREE_MODE = "true";

  assert.equal(zeroCostAiProvider(), null);
  assert.equal(continuousAiStatus().enabled, false);

  for (const [key, value] of Object.entries(previous)) {
    if (value == null) delete process.env[
      { free: "APEX_FREE_MODE", openrouter: "OPENROUTER_API_KEY", gemini: "GEMINI_API_KEY", confirmed: "APEX_GEMINI_FREE_TIER_CONFIRMED" }[key]
    ];
    else process.env[
      { free: "APEX_FREE_MODE", openrouter: "OPENROUTER_API_KEY", gemini: "GEMINI_API_KEY", confirmed: "APEX_GEMINI_FREE_TIER_CONFIRMED" }[key]
    ] = value;
  }
});

test("OpenRouter free router is selected only when its key exists", () => {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.APEX_FREE_MODE = "true";
  process.env.OPENROUTER_API_KEY = "test-key";

  const provider = zeroCostAiProvider();
  assert.deepEqual(provider, {
    provider: "openrouter",
    model: "openrouter/free",
    basis: "OpenRouter free router"
  });

  if (previous == null) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = previous;
});

test("Gemini is never inferred to be free from key presence alone", () => {
  const previous = {
    gemini: process.env.GEMINI_API_KEY,
    confirmed: process.env.APEX_GEMINI_FREE_TIER_CONFIRMED,
    openrouter: process.env.OPENROUTER_API_KEY
  };

  process.env.APEX_FREE_MODE = "true";
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.APEX_GEMINI_FREE_TIER_CONFIRMED;

  assert.equal(zeroCostAiProvider(), null);

  process.env.APEX_GEMINI_FREE_TIER_CONFIRMED = "true";
  assert.equal(zeroCostAiProvider().provider, "google");

  if (previous.gemini == null) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = previous.gemini;
  if (previous.confirmed == null) delete process.env.APEX_GEMINI_FREE_TIER_CONFIRMED;
  else process.env.APEX_GEMINI_FREE_TIER_CONFIRMED = previous.confirmed;
  if (previous.openrouter == null) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = previous.openrouter;
});

test("autonomous AI task carries explicit provider and durable dedupe key", () => {
  const task = buildAutonomousAiTask({
    role: "qa-review",
    task: "Find one missing acceptance test.",
    provider: "openrouter",
    model: "openrouter/free",
    cycle: 120000
  });

  assert.equal(task.task, "ai-inference");
  assert.equal(task.payload.provider, "openrouter");
  assert.equal(task.payload.model, "openrouter/free");
  assert.match(task.dedupeKey, /^locked-ai:qa-review:/);
  assert.equal(task.payload.role, "qa-review");
});
