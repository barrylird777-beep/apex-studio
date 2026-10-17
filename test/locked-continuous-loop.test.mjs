import test from "node:test";
import assert from "node:assert/strict";

import {
  zeroCostAiProvider,
  buildAutonomousAiTask,
  continuousAiStatus,
  seedAutonomousAiWork
} from "../src/core/autonomy/locked-continuous-loop.mjs";

test("zero-cost AI is fail-closed by default", () => {
  const previous = {
    free: process.env.APEX_FREE_MODE,
    openrouter: process.env.OPENROUTER_API_KEY,
  };

  delete process.env.OPENROUTER_API_KEY;
  process.env.APEX_FREE_MODE = "true";

  assert.equal(zeroCostAiProvider(), null);
  assert.equal(continuousAiStatus().enabled, false);

  for (const [key, value] of Object.entries(previous)) {
    if (value == null) delete process.env[
      { free: "APEX_FREE_MODE", openrouter: "OPENROUTER_API_KEY" }[key]
    ];
    else process.env[
      { free: "APEX_FREE_MODE", openrouter: "OPENROUTER_API_KEY" }[key]
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

);

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

test("autonomous AI can enqueue through an injected authoritative queue", async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  const queued = [];
  try {
    const result = await seedAutonomousAiWork({
      maxTasks: 1,
      getQueueStats: async () => ({ queued: 0 }),
      enqueueTask: async item => { queued.push(item); return { id: item.id, durable: true }; }
    });
    assert.equal(result.queued, 1);
    assert.equal(queued.length, 1);
    assert.equal(queued[0].task, "ai-inference");
    assert.equal(queued[0].role, "scripture-research");
  } finally {
    if (previous == null) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
  }
});

test("autonomous AI stops seeding when the authoritative queue is full", async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  let attempts = 0;
  try {
    const result = await seedAutonomousAiWork({
      maxTasks: 2,
      getQueueStats: async () => ({ queued: 4 }),
      enqueueTask: async () => { attempts++; return { id: "unexpected" }; }
    });
    assert.equal(result.queued, 0);
    assert.equal(attempts, 0);
  } finally {
    if (previous == null) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
  }
});
