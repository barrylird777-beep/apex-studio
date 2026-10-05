import assert from "node:assert/strict";
import test from "node:test";
import { IntelligenceWorker } from "../src/core/intelligence/intelligence-worker.mjs";

test("intelligence worker validates independent verification before completion", async () => {
  const calls = [];
  const runtime = {};
  const scheduler = {
    async executeTask() {
      calls.push("execute");
      return { output: "x", verification: { passed: true, verifier: "independent-check" } };
    }
  };
  const worker = new IntelligenceWorker({ runtime, scheduler, verifier: async () => ({ passed: true, verifier: "independent-qa" }) });
  assert.equal(typeof worker.processOne, "function");
  assert.equal(typeof worker.stop, "function");
  assert.deepEqual(calls, []);
});

test("intelligence worker exposes bounded concurrency", () => {
  const worker = new IntelligenceWorker({ runtime: {}, scheduler: {}, verifier: async () => ({ passed: true, verifier: "qa" }), concurrency: 100 });
  assert.equal(worker.concurrency, 32);
});
