import test from "node:test";
import assert from "node:assert/strict";

import { APEX_APPS, assertSixAppInvariant, getApexApp } from "../src/apps/apex-six-apps.mjs";
import { evaluateOpportunity } from "../src/apps/apex-opportunity-engine.mjs";
import { rapidProductionStatus } from "../src/apps/apex-rapid-production.mjs";
import { gardenStatus } from "../src/apps/garden-of-apex.mjs";
import { kornKnobStatus } from "../src/apps/korn-knob.mjs";
import { studioStatus } from "../src/apps/apex-studio.mjs";
import { forgeStatus } from "../src/apps/forge-processing-engine.mjs";

test("Apex exposes exactly six canonical apps", () => {
  assert.equal(assertSixAppInvariant(), true);
  assert.equal(Object.keys(APEX_APPS).length, 6);
  assert.deepEqual(
    Object.values(APEX_APPS).map(app => app.name),
    [
      "KornKnob",
      "ApexRapidProduction",
      "ApexOpportunityEngine",
      "ApexStudio",
      "GardenOfApex",
      "ForgeProcessingEngine"
    ]
  );
});

test("six app boundaries resolve to their locked systems", () => {
  assert.equal(getApexApp("korn-knob").system, "kornknob");
  assert.equal(getApexApp("apex-rapid-production").system, "apex-studio");
  assert.equal(getApexApp("apex-opportunity-engine").system, "apex-studio");
  assert.equal(getApexApp("apex-studio").system, "apex-studio");
  assert.equal(getApexApp("garden-of-apex").system, "garden-of-apex");
  assert.equal(getApexApp("forge-processing-engine").system, "apex-studio");
});

test("opportunity engine evaluates without owning production", () => {
  const result = evaluateOpportunity({
    demand: 1,
    evidence: 1,
    audienceFit: 1,
    revenuePotential: 1,
    speedToMarket: 1,
    repeatability: 1,
    novelty: 1,
    risk: 0,
    productionCost: 0
  });
  assert.equal(result.engine, "ApexOpportunityEngine");
  assert.ok(result.score >= 0 && result.score <= 100);
});

test("rapid production contract preserves commercial output", () => {
  const result = rapidProductionStatus();
  assert.equal(result.priceUsd, 25);
  assert.equal(result.previewSeconds, 10);
  assert.equal(result.paidOutputSeconds, 30);
  assert.equal(result.aspectRatio, "9:16");
});

test("Garden, KornKnob, Studio and Forge expose operational status", () => {
  assert.equal(gardenStatus().app.id, "garden-of-apex");
  assert.equal(kornKnobStatus().app.id, "korn-knob");
  assert.equal(studioStatus().app.id, "apex-studio");
  assert.equal(forgeStatus().app.id, "forge-processing-engine");
});
