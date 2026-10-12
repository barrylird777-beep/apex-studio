import test from "node:test";
import assert from "node:assert/strict";
import { buildMusicProductionPlan, buildMusicPrompt, createMusicTrack, verifyMusicGardenPackage } from "../src/core/music/music-studio.mjs";

const garden = {
  system: "garden-of-apex",
  graphVersion: "garden-lore-v1",
  packageHash: "abc123",
  references: ["garden:Apex", "garden:JesusFreaks"]
};

test("Korn music requires Garden package", () => {
  assert.throws(() => createMusicTrack({ contentDomain: "korn", title: "Test" }), /Garden of Apex package/);
});

test("Korn music accepts verified Garden package", () => {
  const track = createMusicTrack({ contentDomain: "korn", title: "Korn Theme", gardenPackage: garden, role: "music" });
  assert.equal(track.contentDomain, "korn");
  assert.equal(track.tuningHz, 432);
  assert.match(buildMusicPrompt({ title: "Korn Theme", gardenPackage: garden }), /432 Hz only/);
  assert.deepEqual(verifyMusicGardenPackage({ contentDomain: "korn", gardenPackage: garden }, garden.references).verified, true);
});

test("Bible/original music does not require Garden", () => {
  const plan = buildMusicProductionPlan({ contentDomain: "bible", title: "Exodus Score", genre: ["cinematic"], tracks: [{ title: "Main", role: "music", contentDomain: "bible", provenance: { source: "studio" } }] });
  assert.equal(plan.contentDomain, "bible");
});

test("music prompt preserves world package provenance", () => {
  const prompt = buildMusicPrompt({ title: "Throne Theme", genre: ["dark-fantasy"], mood: ["ominous"], gardenPackage: garden });
  assert.match(prompt, /garden-lore-v1/);
  assert.match(prompt, /abc123/);
});


test("Jesus Freaks music is locked to 432 Hz and production plans inherit the canonical domain", () => {
  assert.throws(() => createMusicTrack({ contentDomain: "korn", title: "Wrong Tuning", gardenPackage: garden, tuningHz: 440 }), /432 Hz only/);
  assert.throws(() => buildMusicPrompt({ title: "Wrong Tuning", contentDomain: "korn", tuningHz: 440 }), /432 Hz only/);
  const plan = buildMusicProductionPlan({
    contentDomain: "korn",
    gardenPackage: garden,
    tracks: [{ title: "Jesus Freaks Theme", role: "music", provenance: { source: "studio" } }]
  });
  assert.equal(plan.musicalIntent.tuningHz, 432);
  assert.equal(plan.tracks[0].contentDomain, "korn");
  assert.equal(plan.tracks[0].tuningHz, 432);
  assert.throws(() => buildMusicProductionPlan({
    contentDomain: "korn",
    gardenPackage: garden,
    tracks: [{ title: "Mismatched Domain", role: "music", contentDomain: "bible", provenance: { source: "studio" } }]
  }), /content domain must match/);
});
