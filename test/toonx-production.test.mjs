import test from "node:test";
import assert from "node:assert/strict";
import {
  TOONX_EPISODE_COUNT,
  episodeCode,
  deterministicEpisodeId,
  buildEpisode,
  canAdvanceEpisode,
  validateBroadcastReadiness,
  buildInitialProductionBatch,
  buildLaunchManifest,
  buildEpisodeProductionJobs
} from "../src/core/toonx-production.mjs";
import { buildAnimationPlan } from "../src/jobs/toonx-handlers.mjs";

test("TOONX has exactly 2,785 deterministic episode slots", () => {
  assert.equal(TOONX_EPISODE_COUNT, 2785);
  assert.equal(episodeCode(1), "APX-0001");
  assert.equal(episodeCode(2785), "APX-2785");
  assert.equal(deterministicEpisodeId(1), deterministicEpisodeId(1));
  assert.notEqual(deterministicEpisodeId(1), deterministicEpisodeId(2));
});

test("episode production cannot skip gates", () => {
  const episode = buildEpisode(1, { title: "Test" });
  assert.equal(canAdvanceEpisode(episode, "STORY"), false);
  assert.equal(canAdvanceEpisode({ ...episode, creativeBrief: { premise: "ready" } }, "STORY"), true);
  assert.equal(canAdvanceEpisode(episode, "SCRIPT"), false);
  assert.equal(canAdvanceEpisode(episode, "QC"), false);
});

test("broadcast readiness requires QC, master, catalog and schedule", () => {
  const episode = buildEpisode(1);
  assert.equal(validateBroadcastReadiness(episode).ready, false);
  const ready = {
    ...episode,
    state: "SCHEDULED",
    scheduled: true,
    catalogRegistered: true,
    statuses: { ...episode.statuses, qc: "passed", master: "approved" },
    inspectionApproved: true
  };
  assert.deepEqual(validateBroadcastReadiness(ready), { ready: true, errors: [] });
});

test("initial batch creates the complete deterministic launch inventory", () => {
  const batch = buildInitialProductionBatch();
  assert.equal(batch.length, 2785);
  assert.equal(batch[0].episodeCode, "APX-0001");
  assert.equal(batch.at(-1).episodeCode, "APX-2785");
  assert.equal(new Set(batch.map(e => e.episodeCode)).size, 2785);
  assert.equal(buildLaunchManifest().episodeCount, 2785);
});


test("production job graph covers every real production stage in order", () => {
  const jobs = buildEpisodeProductionJobs(buildEpisode(1, { title: "Pilot" }));
  assert.deepEqual(jobs.map(j => j.type), [
    "toonx.episode.story", "toonx.episode.script", "toonx.episode.storyboard",
    "toonx.episode.voice", "toonx.episode.audio", "toonx.episode.visual-development",
    "toonx.episode.animation", "toonx.episode.edit", "toonx.episode.qc",
    "toonx.episode.master", "toonx.episode.inspection", "toonx.episode.catalog", "toonx.episode.schedule"
  ]);
  assert.equal(new Set(jobs.map(j => j.dedupeKey)).size, jobs.length);
});


test("TOONX animation planning covers the complete episode runtime", () => {
  const plan = buildAnimationPlan(180);
  assert.equal(plan.length, 30);
  assert.equal(plan.reduce((sum, scene) => sum + scene.durationSeconds, 0), 180);
  const odd = buildAnimationPlan(181);
  assert.equal(odd.length, 31);
  assert.equal(odd.at(-1).durationSeconds, 1);
  assert.equal(odd.reduce((sum, scene) => sum + scene.durationSeconds, 0), 181);
});
