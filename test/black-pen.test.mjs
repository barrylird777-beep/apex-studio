import test from "node:test";
import assert from "node:assert/strict";

import {
  SYSTEMS,
  SURFACES,
  JESUS_FREAK_TYPES,
  POPCORN_STATES,
  PROTOCOB_STATES,
  WORKER_AUTHORITIES,
  EVIDENCE_TYPES,
  LINEAGE_RELATIONSHIPS,
  assertSystemBoundary,
  assertSpecialSearchBoundary,
  createKernel,
  createPopcorn,
  createCornNut,
  createCob,
  createProtocob,
  createEvidence,
  createInspection,
  createDevelopmentRecord,
  addLineage,
  transitionObject,
  canTransition,
  canDeclareFinished,
  assertFinishedProtocob,
  assertGeminiNotFinalAuthority,
  assertReviewerAuthority,
  assertNoFourthSystem,
  validateObject,
  validateLineage,
  validateFinishedProduction
} from "../src/canon/black-pen.mjs";

test("Apex has exactly three systems", () => {
  assert.deepEqual(Object.values(SYSTEMS), [
    "apex-studio",
    "garden-of-apex",
    "kornknob"
  ]);
});

test("Special Search belongs permanently to Apex Studio", () => {
  assert.doesNotThrow(() => assertSpecialSearchBoundary(SYSTEMS.STUDIO));
  assert.throws(
    () => assertSpecialSearchBoundary(SYSTEMS.GARDEN),
    /Special Search permanently belongs to Apex Studio/
  );
  assert.equal(SURFACES.SPECIAL_SEARCH, "special-search");
});

test("system capabilities cannot cross ownership boundaries", () => {
  assert.doesNotThrow(() => assertSystemBoundary(SYSTEMS.STUDIO, "production"));
  assert.doesNotThrow(() => assertSystemBoundary(SYSTEMS.GARDEN, "knowledge"));
  assert.doesNotThrow(() => assertSystemBoundary(SYSTEMS.KORNKNOB, "model"));

  assert.throws(
    () => assertSystemBoundary(SYSTEMS.GARDEN, "production"),
    /BLACK-PEN boundary violation/
  );
});

test("TOONX is a surface and not a fourth system", () => {
  assert.equal(SURFACES.TOONX, "toonx");

  assert.doesNotThrow(() => assertNoFourthSystem({
    system: SYSTEMS.STUDIO,
    surface: SURFACES.TOONX
  }));

  assert.throws(
    () => assertNoFourthSystem({ system: "toonx-system" }),
    /Unknown Apex system|forbidden fourth system/
  );
});

test("Kernel belongs to Garden and specialization does not restrict investigation", () => {
  const kernel = createKernel({
    specialties: ["music"],
    expertise: {
      music: {
        level: 0,
        evidenceCount: 0
      }
    }
  });

  assert.equal(kernel.type, JESUS_FREAK_TYPES.KERNEL);
  assert.equal(kernel.system, SYSTEMS.GARDEN);
  assert.equal(kernel.state, "kernel");

  kernel.data.investigations.push({
    id: "investigation_1",
    domain: "scripture",
    kind: "research"
  });

  assert.equal(kernel.data.investigations[0].domain, "scripture");
});

test("Popcorn preserves durable discovery lineage fields", () => {
  const popcorn = createPopcorn({
    kernelIds: ["kernel_1"],
    source: {
      uri: "source://example",
      title: "Example source"
    },
    discoveryContext: {
      room: "research-room"
    },
    extract: {
      text: "extracted concept"
    },
    interpretation: {
      claim: "interpreted claim"
    },
    verification: {
      status: "verified"
    }
  });

  assert.equal(popcorn.type, JESUS_FREAK_TYPES.POPCORN);
  assert.equal(popcorn.system, SYSTEMS.GARDEN);
  assert.equal(popcorn.state, POPCORN_STATES.DISCOVERED);
  assert.equal(popcorn.data.kernelIds[0], "kernel_1");
  assert.equal(popcorn.data.extract.text, "extracted concept");
  assert.equal(popcorn.data.interpretation.claim, "interpreted claim");
  assert.equal(popcorn.data.verification.status, "verified");
});

test("CornNut evaluates while KornPops remains the rating mechanism", () => {
  const cornNut = createCornNut({
    targetId: "popcorn_1",
    targetType: JESUS_FREAK_TYPES.POPCORN,
    criteria: {
      originality: 1,
      accuracy: 1,
      productionFeasibility: 1
    },
    ratings: {
      KornPops: 8
    },
    reasoning: "Strong discovery with viable production path."
  });

  assert.equal(cornNut.type, JESUS_FREAK_TYPES.CORNNUT);
  assert.equal(cornNut.system, SYSTEMS.GARDEN);
  assert.equal(cornNut.data.ratingSystem, "KornPops");
  assert.equal(cornNut.data.ratings.KornPops, 8);
});

test("Cob belongs to Studio production", () => {
  const cob = createCob({
    role: "editor",
    specialization: "editing",
    capabilities: ["editing", "compositing"]
  });

  assert.equal(cob.type, JESUS_FREAK_TYPES.COB);
  assert.equal(cob.system, SYSTEMS.STUDIO);
});

test("Protocob does not begin as a finished production", () => {
  const protocob = createProtocob({
    popcornId: "popcorn_1",
    title: "Test Production",
    format: "toonx"
  });

  assert.equal(protocob.type, JESUS_FREAK_TYPES.PROTOCOB);
  assert.equal(protocob.system, SYSTEMS.STUDIO);
  assert.equal(protocob.state, PROTOCOB_STATES.CONCEPT);
  assert.equal(canDeclareFinished(protocob), false);
});

test("invalid Protocob transitions are rejected", () => {
  const protocob = createProtocob({
    title: "Test",
    format: "toonx"
  });

  assert.equal(
    canTransition(
      JESUS_FREAK_TYPES.PROTOCOB,
      PROTOCOB_STATES.CONCEPT,
      PROTOCOB_STATES.RELEASED
    ),
    false
  );

  assert.throws(
    () => transitionObject(protocob, PROTOCOB_STATES.RELEASED),
    /Invalid protocob transition/
  );
});

test("production transitions preserve evidence", () => {
  const protocob = createProtocob({
    title: "Evidence Test",
    format: "toonx"
  });

  const evidence = createEvidence({
    type: EVIDENCE_TYPES.DEVELOPMENT,
    objectId: protocob.id,
    content: {
      readiness: "ready"
    }
  });

  transitionObject(protocob, PROTOCOB_STATES.DEVELOPMENT, {
    actorId: "cob_1",
    evidence: [evidence.id]
  });

  assert.equal(protocob.state, PROTOCOB_STATES.DEVELOPMENT);
  assert.equal(protocob.data.transitions.length, 1);
  assert.equal(protocob.data.transitions[0].evidence[0].id, evidence.id);
});

test("King Cob is the only final inspection authority", () => {
  assert.doesNotThrow(() => createInspection({
    protocobId: "protocob_1",
    authority: WORKER_AUTHORITIES.KING_COB,
    inspectorId: "king_cob_1",
    result: "approved",
    evidenceIds: ["inspection_evidence_1"]
  }));

  assert.throws(
    () => createInspection({
      protocobId: "protocob_1",
      authority: WORKER_AUTHORITIES.REVIEWER,
      inspectorId: "reviewer_1",
      result: "approved",
      evidenceIds: ["inspection_evidence_1"]
    }),
    /Only King Cob/
  );
});

test("Gemini cannot self-certify production readiness", () => {
  assert.throws(
    () => assertGeminiNotFinalAuthority("gemini"),
    /Gemini cannot self-certify/
  );

  assert.throws(
    () => assertReviewerAuthority("gemini"),
    /Gemini/
  );
});

test("development readiness requires evidence", () => {
  const record = createDevelopmentRecord({
    popcornId: "popcorn_1",
    perspective: "narrative",
    readiness: "ready",
    evidenceIds: ["development_evidence_1"]
  });

  assert.equal(record.readiness, "ready");
  assert.equal(record.evidenceIds.length, 1);
});

test("lineage cannot reference missing objects", () => {
  const popcorn = createPopcorn({
    kernelIds: ["kernel_1"]
  });

  addLineage(popcorn, {
    relationship: LINEAGE_RELATIONSHIPS.DERIVED_FROM,
    sourceId: "source_1",
    sourceType: "source"
  });

  const registry = new Map([[popcorn.id, popcorn]]);

  assert.throws(
    () => validateLineage(popcorn, registry),
    /Broken lineage/
  );
});

test("lineage remains traceable through the object registry", () => {
  const source = {
    id: "source_1",
    type: "source",
    system: SYSTEMS.GARDEN
  };

  const popcorn = createPopcorn({
    kernelIds: ["kernel_1"]
  });

  addLineage(popcorn, {
    relationship: LINEAGE_RELATIONSHIPS.DERIVED_FROM,
    sourceId: source.id,
    sourceType: source.type
  });

  const registry = new Map([
    [source.id, source],
    [popcorn.id, popcorn]
  ]);

  assert.doesNotThrow(() => validateLineage(popcorn, registry));
});

test("finished Protocob requires King Cob inspection", () => {
  const protocob = createProtocob({
    title: "Final Test",
    format: "toonx",
    state: PROTOCOB_STATES.RELEASE_READY
  });

  assert.equal(canDeclareFinished(protocob), false);

  protocob.data.inspections.push({
    id: "inspection_1",
    authority: WORKER_AUTHORITIES.KING_COB,
    result: "approved",
    evidenceIds: ["inspection_1_evidence"]
  });

  assert.equal(canDeclareFinished(protocob), true);
  assert.doesNotThrow(() => assertFinishedProtocob(protocob));
});

test("finished production requires evidence of required classes", () => {
  const protocob = createProtocob({
    title: "Validated Production",
    format: "toonx",
    state: PROTOCOB_STATES.RELEASE_READY
  });

  const sourceEvidence = createEvidence({
    type: EVIDENCE_TYPES.SOURCE,
    objectId: protocob.id
  });

  const assetEvidence = createEvidence({
    type: EVIDENCE_TYPES.ASSET,
    objectId: protocob.id
  });

  const reviewEvidence = createEvidence({
    type: EVIDENCE_TYPES.REVIEW,
    objectId: protocob.id
  });

  const inspectionEvidence = createEvidence({
    type: EVIDENCE_TYPES.INSPECTION,
    objectId: protocob.id
  });

  protocob.data.inspections.push({
    id: "inspection_1",
    authority: WORKER_AUTHORITIES.KING_COB,
    result: "approved",
    evidenceIds: [
      sourceEvidence.id,
      assetEvidence.id,
      reviewEvidence.id,
      inspectionEvidence.id
    ]
  });

  const registry = new Map([
    [sourceEvidence.id, sourceEvidence],
    [assetEvidence.id, assetEvidence],
    [reviewEvidence.id, reviewEvidence],
    [inspectionEvidence.id, inspectionEvidence],
    [protocob.id, protocob]
  ]);

  assert.doesNotThrow(() => validateFinishedProduction({
    protocob,
    registry,
    requiredEvidenceTypes: [
      EVIDENCE_TYPES.SOURCE,
      EVIDENCE_TYPES.ASSET,
      EVIDENCE_TYPES.REVIEW,
      EVIDENCE_TYPES.INSPECTION
    ]
  }));
});

test("finished original production defaults to source evidence", () => {
  const protocob = createProtocob({
    title: "Original Animation",
    format: "toonx",
    state: PROTOCOB_STATES.RELEASE_READY
  });

  const sourceEvidence = createEvidence({
    type: EVIDENCE_TYPES.SOURCE,
    objectId: protocob.id
  });
  const assetEvidence = createEvidence({
    type: EVIDENCE_TYPES.ASSET,
    objectId: protocob.id
  });
  const reviewEvidence = createEvidence({
    type: EVIDENCE_TYPES.REVIEW,
    objectId: protocob.id
  });
  const inspectionEvidence = createEvidence({
    type: EVIDENCE_TYPES.INSPECTION,
    objectId: protocob.id
  });

  protocob.data.inspections.push({
    id: "inspection_original",
    authority: WORKER_AUTHORITIES.KING_COB,
    result: "approved",
    evidenceIds: [
      sourceEvidence.id,
      assetEvidence.id,
      reviewEvidence.id,
      inspectionEvidence.id
    ]
  });

  const registry = new Map([
    [sourceEvidence.id, sourceEvidence],
    [assetEvidence.id, assetEvidence],
    [reviewEvidence.id, reviewEvidence],
    [inspectionEvidence.id, inspectionEvidence],
    [protocob.id, protocob]
  ]);

  assert.doesNotThrow(() => validateFinishedProduction({
    protocob,
    registry
  }));
});

test("object validation rejects forbidden systems", () => {
  const invalid = {
    id: "bad_1",
    type: "unknown",
    system: "toonx-system",
    data: {}
  };

  assert.throws(
    () => validateObject(invalid),
    /Unknown Apex system|forbidden fourth system/
  );
});
