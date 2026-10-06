import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { createAiCrewEngine } from "../src/core/mesh/ai-crew-engine.mjs";

test("AI crew queues and completes bounded work", async () => {
  let calls = 0;
  const engine = createAiCrewEngine({
    concurrency: 2,
    dispatch: async payload => {
      calls++;
      assert.equal(payload.type, "inference");
      return { ok: true, text: "crew result" };
    }
  });

  const jobs = engine.burst(6, { test: true });
  assert.equal(jobs.length, 6);

  for (let i = 0; i < 50 && engine.status().completed < 6; i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }

  const status = engine.status();
  assert.equal(status.completed, 6);
  assert.equal(status.failed, 0);
  assert.equal(calls, 6);
  engine.stop();
});

test("AI crew exposes specialized production roles", () => {
  const source = fs.readFileSync(new URL("../src/core/mesh/crew-inference-worker.mjs", import.meta.url), "utf8");
  for (const role of ["researcher", "verifier", "scriptwriter", "visual_director", "cinematographer", "voice_director", "audio_director", "composer", "sfx_designer", "editor", "qc"]) {
    assert.match(source, new RegExp("\\b" + role + "\\b"));
  }
  assert.match(source, /roleSystem\(role, system\)/);
});

test("AI crew maps engine roles to specialized production roles and hedges primaries", () => {
  const source = fs.readFileSync(new URL("../src/core/mesh/crew-inference-worker.mjs", import.meta.url), "utf8");
  assert.match(source, /function normalizeRole\(role\)/);
  assert.match(source, /"knowledge-research": "researcher"/);
  assert.match(source, /"visual-direction": "visual_director"/);
  assert.match(source, /"release-qa": "qc"/);
  assert.match(source, /Promise\.any\(pending\)/);
  assert.match(source, /order\.slice\(0, 2\)/);
});

test("AI crew role aliases match normalized role keys", () => {
  const source = fs.readFileSync(new URL("../src/core/mesh/crew-inference-worker.mjs", import.meta.url), "utf8");
  assert.match(source, /visual_direction: "visual_director"/);
  assert.match(source, /knowledge_research: "researcher"/);
  assert.match(source, /release_qa: "qc"/);
  assert.match(source, /infrastructure: "infrastructure"/);
  assert.match(source, /infrastructure: "Infrastructure Engineer/);
});
