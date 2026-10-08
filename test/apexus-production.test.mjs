import test from "node:test";
import assert from "node:assert/strict";
import {
  APEXUS_EPISODE_COUNT,
  episodeCode,
  deterministicEpisodeId,
  buildEpisode,
  canAdvanceEpisode,
  validateBroadcastReadiness,
  buildInitialProductionBatch,
  buildLaunchManifest,
  buildEpisodeProductionJobs
} from "../src/core/apexus-production.mjs";
import { buildAnimationPlan } from "../src/jobs/apexus-handlers.mjs";

test("Apexus has exactly 2,785 deterministic episode slots", () => {
  assert.equal(APEXUS_EPISODE_COUNT, 2785);
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
    statuses: { ...episode.statuses, qc: "passed", master: "approved" }
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
    "apexus.episode.story", "apexus.episode.script", "apexus.episode.storyboard",
    "apexus.episode.voice", "apexus.episode.audio", "apexus.episode.visual-development",
    "apexus.episode.animation", "apexus.episode.edit", "apexus.episode.qc",
    "apexus.episode.master", "apexus.episode.catalog", "apexus.episode.schedule"
  ]);
  assert.equal(new Set(jobs.map(j => j.dedupeKey)).size, jobs.length);
});


test("Apexus animation plan covers the full runtime with 6-second generation units", () => {
  const plan = buildAnimationPlan(180);
  assert.equal(plan.length, 30);
  assert.equal(plan[0].durationSeconds, 6);
  assert.equal(plan.at(-1).durationSeconds, 6);
  assert.equal(plan.reduce((sum, scene) => sum + scene.durationSeconds, 0), 180);

  const odd = buildAnimationPlan(181);
  assert.equal(odd.length, 31);
  assert.equal(odd.slice(0, -1).every(scene => scene.durationSeconds === 6), true);
  assert.equal(odd.at(-1).durationSeconds, 1);
  assert.equal(odd.reduce((sum, scene) => sum + scene.durationSeconds, 0), 181);
});
