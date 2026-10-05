import test from "node:test";
import assert from "node:assert/strict";
import { AiCircuitBreaker, AiCircuitOpenError, HALF_OPEN, OPEN, CLOSED } from "../src/providers/ai-circuit-breaker.mjs";

test("opens after repeated 429s and fast-fails", async () => {
  const breaker = new AiCircuitBreaker({ provider: "test", failureThreshold: 3, resetTimeoutMs: 100, jitterMs: 0 });
  const fail = async () => { throw Object.assign(new Error("429"), { status: 429 }); };
  for (let i = 0; i < 3; i++) await assert.rejects(() => breaker.execute(fail));
  assert.equal(breaker.getState(), OPEN);
  await assert.rejects(() => breaker.execute(async () => "must-not-run"), error => error instanceof AiCircuitOpenError);
});

test("uses a single half-open probe and closes on recovery", async () => {
  let now = 0;
  const breaker = new AiCircuitBreaker({ provider: "test", failureThreshold: 1, resetTimeoutMs: 100, jitterMs: 0, now: () => now });
  await assert.rejects(() => breaker.execute(async () => { throw Object.assign(new Error("503"), { status: 503 }); }));
  assert.equal(breaker.getState(), OPEN);
  now = 101;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = breaker.execute(async () => { await gate; return "ok"; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(breaker.getState(), HALF_OPEN);
  await assert.rejects(() => breaker.execute(async () => "second-probe"), error => error instanceof AiCircuitOpenError);
  release();
  assert.equal(await first, "ok");
  assert.equal(breaker.getState(), CLOSED);
});

test("non-provider failures do not trip the circuit", async () => {
  const breaker = new AiCircuitBreaker({ failureThreshold: 1, jitterMs: 0 });
  await assert.rejects(() => breaker.execute(async () => { throw Object.assign(new Error("bad input"), { status: 400 }); }));
  assert.equal(breaker.getState(), CLOSED);
});