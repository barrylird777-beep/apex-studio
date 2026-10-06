import test from "node:test";
import assert from "node:assert/strict";
import { normalizeContentDomain, contentDomainPolicy } from "../src/core/content/content-domains.mjs";
import { createMusicRadarHandoff } from "../src/core/music/music-radar-contract.mjs";
import { assertProductionHandoff } from "../src/core/validation/production-contracts.mjs";

test("content domains allow independent Bible films and Korn productions", () => {
  assert.equal(normalizeContentDomain("bible"), "bible");
  assert.equal(contentDomainPolicy("bible").requiresGardenPackage, false);
  assert.equal(contentDomainPolicy("korn").requiresGardenPackage, true);
  assert.equal(contentDomainPolicy("original").canProduceFilm, true);
});

test("Music Radar handoff stays standalone while carrying production context", () => {
  const handoff = createMusicRadarHandoff({
    projectId: "music:film-score-1",
    contentDomain: "bible",
    musicalIntent: {
      genre: ["cinematic", "orchestral"],
      fusion: ["dark-fantasy"],
      mood: ["tense", "holy"],
      christianMode: true,
      purpose: "film-score"
    },
    assets: [{
      assetId: "score-1",
      kind: "music",
      title: "Opening Score",
      format: "wav",
      checksum: "abc123",
      provenance: { source: "music-radar", sourceId: "score-1", sourceVersion: "1" }
    }]
  });
  assert.equal(handoff.contentDomain, "bible");
  assert.equal(handoff.worldPackage.system, "none");
  assert.equal(handoff.assets[0].kind, "music");
});

test("Bible production handoff does not require Garden references", () => {
  const handoff = assertProductionHandoff({
    contractVersion: "apex-production-handoff.v1",
    projectId: "bible:Genesis",
    contentDomain: "bible",
    episodeId: "Genesis:1:full",
    gardenPackage: {
      graphVersion: "garden-lore-v1",
      packageHash: "not-used-by-bible",
      references: []
    },
    artifact: {
      kind: "research",
      version: "1",
      contentHash: "abc"
    },
    provenance: {
      source: "Apex Studio episode-production control plane",
      verified: true
    }
  });
  assert.equal(handoff.contentDomain, "bible");
});
