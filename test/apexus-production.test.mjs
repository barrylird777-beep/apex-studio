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
  buildLaunchManifest
} from "../src/core/apexus-production.mjs";

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
