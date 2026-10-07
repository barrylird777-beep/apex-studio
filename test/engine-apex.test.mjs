import test from "node:test";
import assert from "node:assert/strict";
import { scoreOpportunity, buildEngineBrief } from "../src/core/engine-apex.mjs";

test("EngineApex scores opportunities deterministically within 0-100", () => {
  const result = scoreOpportunity({ demand: 1, evidence: 1, audienceFit: 1, revenuePotential: 1, speedToMarket: 1, repeatability: 1, novelty: 1, risk: 0, productionCost: 0 });
  assert.ok(result.score >= 0 && result.score <= 100);
  assert.equal(result.score, 96);
});

test("EngineApex requires a topic for a production brief", () => {
  assert.throws(() => buildEngineBrief({}), /topic is required/);
});

test("EngineApex builds a separated handoff brief", () => {
  const brief = buildEngineBrief({ topic: "Psalm 23", handoff: "ApexStudio" });
  assert.equal(brief.engine, "EngineApex");
  assert.equal(brief.handoff, "ApexStudio");
  assert.equal(brief.evidenceRequired, true);
});
