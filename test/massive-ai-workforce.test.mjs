import test from "node:test";
import assert from "node:assert/strict";
import { createMassiveAiWorkforce, DEFAULT_TASKS } from "../src/core/mesh/massive-ai-workforce.mjs";

test("massive AI workforce covers the full logical fleet without creating OS-thread assumptions", async () => {
  const workers = Array.from({ length: 10 }, (_, i) => ({ id: "w" + i, role: "performance" }));
  const jobs = [];
  const crew = {
    enqueue(input) {
      const job = { id: "crew-" + jobs.length, status: "queued", ...input };
      jobs.push(job);
      return job;
    }
  };
  const workforce = createMassiveAiWorkforce({
    fleet: { workers },
    crew,
    maxActive: 2,
    batchSize: 10
  });
  const result = await workforce.dispatchWorkers({ limit: workers.length });
  assert.equal(result.length, workers.length);
  assert.equal(jobs.length, workers.length);
  assert.equal(workforce.status().dispatched, workers.length);
  assert.equal(workforce.status().fleetWorkers, workers.length);
});

test("worker roles receive concrete task templates and mission evidence requirements", () => {
  const crew = { enqueue() { return { id: "x" }; } };
  const worker = { id: "w1", role: "knowledge-research" };
  const workforce = createMassiveAiWorkforce({ fleet: { workers: [worker] }, crew });
  const task = workforce.taskFor(worker, { scope: "research", requirement: "citation trail" });
  assert.match(task, /provenance/i);
  assert.match(task, /evidence/i);
  assert.match(task, /citation trail/i);
  assert.ok(DEFAULT_TASKS["knowledge-research"]);
});

test("unknown roles still receive a concrete generic assignment", () => {
  const workforce = createMassiveAiWorkforce({
    fleet: { workers: [{ id: "x", role: "new-role" }] },
    crew: { enqueue() { return { id: "x" }; } }
  });
  assert.match(workforce.taskFor({ id: "x", role: "new-role" }), /concrete defect/i);
});
