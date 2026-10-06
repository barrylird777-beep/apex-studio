import test from "node:test";
import assert from "node:assert/strict";
import {
  SYSTEMS, STUDIO_SURFACES, JOB_TYPES,
  createCapability, createCapabilityRequest, createProductionPlan,
  createResearchFinding, createSocialCommand,
  assertOwner, assertStudioNetworkOwnership,
  assertKornKnobModelOwnership, assertGardenKnowledgeOwnership
} from "../src/core/apex-architecture.mjs";

test("master ownership boundaries are explicit", () => {
  assert.equal(assertStudioNetworkOwnership(SYSTEMS.STUDIO), true);
  assert.equal(assertKornKnobModelOwnership(SYSTEMS.KORN_KNOB), true);
  assert.equal(assertGardenKnowledgeOwnership(SYSTEMS.GARDEN), true);
  assert.throws(() => assertOwner(SYSTEMS.KORN_KNOB, "network"), /Ownership violation/);
  assert.throws(() => assertOwner(SYSTEMS.STUDIO, "ai-models"), /Ownership violation/);
  assert.throws(() => assertOwner(SYSTEMS.STUDIO, "knowledge"), /Ownership violation/);
});

test("KORN-KNOB owns Apex AI and media capability records", () => {
  const capability = createCapability({
    kind: "image",
    provider: "example-provider",
    model: "example-image-model",
    capabilities: ["generation","editing"]
  });
  assert.equal(capability.owner, SYSTEMS.KORN_KNOB);
  assert.equal(capability.kind, "image");
});

test("Studio creative surfaces request KORN-KNOB capabilities", () => {
  for (const surface of STUDIO_SURFACES) {
    const request = createCapabilityRequest({
      surface, kind: "audio", requester: SYSTEMS.STUDIO
    });
    assert.equal(request.capabilityOwner, SYSTEMS.KORN_KNOB);
  }
});

test("Garden research distinguishes evidence state", () => {
  assert.equal(createResearchFinding({value:"x",evidence:{known:true}}).evidenceState, "KNOWN");
  assert.equal(createResearchFinding({value:"x",evidence:{observed:true}}).evidenceState, "OBSERVED");
  assert.equal(createResearchFinding({value:"x",evidence:{inferred:true}}).evidenceState, "INFERRED");
  assert.equal(createResearchFinding({value:null}).evidenceState, "UNKNOWN");
});

test("Studio production direction includes the full pipeline and retention hook", () => {
  const plan = createProductionPlan({contentDomain:"bible"});
  assert.equal(plan.stages.length, 13);
  assert.equal(plan.retention.openingHookSeconds, 30);
});

test("Studio social command preserves the operating loop", () => {
  assert.deepEqual(createSocialCommand({}).loop, [
    "DATA","ANALYSIS","EVALUATION","OPPORTUNITIES",
    "PLAN","PRODUCTION","RELEASE","MEASURE","LEARN"
  ]);
});

test("durable job vocabulary covers cross-system workflows", () => {
  for (const type of [
    "capability-discovery","ai-execution","garden-research",
    "garden-chat","korn-world-study","movie-direction",
    "video-production","social-analysis"
  ]) assert.ok(JOB_TYPES.includes(type));
});


test("Studio owns the specialized search engine", () => {
  assert.equal(assertStudioSearchOwnership(SYSTEMS.STUDIO), true);
  assert.throws(() => assertStudioSearchOwnership(SYSTEMS.KORN_KNOB), /Ownership violation/);
  const request = createStudioSearchRequest({query:"best video model for this scene"});
  assert.equal(request.owner, SYSTEMS.STUDIO);
  assert.ok(request.domains.includes("models"));
  assert.ok(request.domains.includes("providers"));
});
