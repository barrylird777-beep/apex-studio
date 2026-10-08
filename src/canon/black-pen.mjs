import { uid, now } from "../core/id.mjs";

export const SYSTEMS = Object.freeze({
  STUDIO: "apex-studio",
  GARDEN: "garden-of-apex",
  KORNKNOB: "kornknob"
});

export const SURFACES = Object.freeze({
  TOONX: "toonx",
  SPECIAL_SEARCH: "special-search"
});

export const JESUS_FREAK_TYPES = Object.freeze({
  KERNEL: "kernel",
  POPCORN: "popcorn",
  CORNNUT: "cornnut",
  COB: "cob",
  PROTOCOB: "protocob"
});

export const KERNEL_LIFE_STAGES = Object.freeze({
  KERNET: "kernet",
  KERNEL: "kernel"
});

export const POPCORN_STATES = Object.freeze({
  DISCOVERED: "discovered",
  VERIFIED: "verified",
  EVALUATING: "evaluating",
  DEVELOPING: "developing",
  PRODUCTION_READY: "production_ready",
  PRODUCED: "produced"
});

export const PROTOCOB_STATES = Object.freeze({
  CONCEPT: "concept",
  DEVELOPMENT: "development",
  PREPRODUCTION: "preproduction",
  PRODUCTION: "production",
  POSTPRODUCTION: "postproduction",
  REVIEW: "review",
  INSPECTION: "inspection",
  RELEASE_READY: "release_ready",
  RELEASED: "released",
  REJECTED: "rejected"
});

export const WORKER_AUTHORITIES = Object.freeze({
  KERNEL: "kernel",
  CORNNUT: "cornnut",
  COB: "cob",
  REVIEWER: "reviewer",
  KING_COB: "king_cob",
  ORCHESTRATOR: "orchestrator",
  OVERSEER: "overseer"
});

export const EVIDENCE_TYPES = Object.freeze({
  SOURCE: "source",
  SCRIPTURE: "scripture",
  DISCOVERY: "discovery",
  EXTRACT: "extract",
  INTERPRETATION: "interpretation",
  VERIFICATION: "verification",
  CONTRIBUTION: "contribution",
  EVALUATION: "evaluation",
  DEVELOPMENT: "development",
  ASSET: "asset",
  RENDER: "render",
  EDIT: "edit",
  REVIEW: "review",
  INSPECTION: "inspection",
  RELEASE: "release"
});

export const LINEAGE_RELATIONSHIPS = Object.freeze({
  DERIVED_FROM: "derived_from",
  EXTRACTED_FROM: "extracted_from",
  VERIFIED_FROM: "verified_from",
  TRANSFORMED_FROM: "transformed_from",
  DEVELOPED_FROM: "developed_from",
  EVALUATED_FROM: "evaluated_from",
  PRODUCED_FROM: "produced_from",
  ASSET_OF: "asset_of",
  RENDER_OF: "render_of",
  REVIEW_OF: "review_of",
  INSPECTION_OF: "inspection_of",
  RELEASE_OF: "release_of",
  CONTRIBUTED_TO: "contributed_to"
});

export const TRANSITIONS = Object.freeze({
  POPCORN: Object.freeze({
    discovered: ["verified", "evaluating"],
    verified: ["evaluating", "developing"],
    evaluating: ["developing", "discovered"],
    developing: ["production_ready", "evaluating"],
    production_ready: ["produced", "developing"],
    produced: []
  }),
  PROTOCOB: Object.freeze({
    concept: ["development", "rejected"],
    development: ["preproduction", "concept", "rejected"],
    preproduction: ["production", "development", "rejected"],
    production: ["postproduction", "preproduction", "rejected"],
    postproduction: ["review", "production", "rejected"],
    review: ["inspection", "postproduction", "rejected"],
    inspection: ["release_ready", "postproduction", "rejected"],
    release_ready: ["released", "inspection"],
    released: [],
    rejected: ["development", "concept"]
  })
});

const OWNERSHIP = Object.freeze({
  [SYSTEMS.STUDIO]: new Set([
    "production",
    "social",
    "network",
    "infrastructure",
    SURFACES.SPECIAL_SEARCH,
    "distribution"
  ]),
  [SYSTEMS.GARDEN]: new Set([
    "knowledge",
    "research",
    "creative_ecosystem",
    "kernel",
    "popcorn",
    "cornnut",
    "development"
  ]),
  [SYSTEMS.KORNKNOB]: new Set([
    "model",
    "provider",
    "media",
    "compute",
    "inference",
    "generation"
  ])
});

const TERMINAL_STATES = new Set([PROTOCOB_STATES.RELEASED]);

function assertString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function assertObject(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function clone(value) {
  return structuredClone(value);
}

export function assertSystem(system) {
  const value = assertString(system, "system");
  if (!Object.values(SYSTEMS).includes(value)) {
    throw new Error(`Unknown Apex system: ${value}`);
  }
  return value;
}

export function assertSurface(surface) {
  const value = assertString(surface, "surface");
  if (!Object.values(SURFACES).includes(value)) {
    throw new Error(`Unknown Apex surface: ${value}`);
  }
  return value;
}

export function assertSystemBoundary(system, capability) {
  const normalizedSystem = assertSystem(system);
  const normalizedCapability = assertString(capability, "capability");
  const owner = Object.entries(OWNERSHIP)
    .find(([, capabilities]) => capabilities.has(normalizedCapability))?.[0];

  if (!owner) {
    throw new Error(`Unregistered Apex capability: ${normalizedCapability}`);
  }

  if (owner !== normalizedSystem) {
    throw new Error(
      `BLACK-PEN boundary violation: ${normalizedCapability} belongs to ${owner}, not ${normalizedSystem}`
    );
  }

  return true;
}

export function assertSpecialSearchBoundary(system) {
  if (system !== SYSTEMS.STUDIO) {
    throw new Error(
      "BLACK-PEN boundary violation: Special Search permanently belongs to Apex Studio"
    );
  }
  return true;
}

export function createObject({
  type,
  system,
  ownerId = null,
  state = null,
  data = {},
  parentId = null,
  lineage = []
}) {
  assertString(type, "type");
  assertSystem(system);
  assertObject(data, "data");

  if (ownerId !== null) assertString(ownerId, "ownerId");
  if (parentId !== null) assertString(parentId, "parentId");

  return {
    id: uid(type),
    type,
    system,
    ownerId,
    state,
    parentId,
    data: clone(data),
    lineage: clone(lineage),
    version: 1,
    createdAt: now(),
    updatedAt: now()
  };
}

export function addLineage(object, {
  relationship,
  sourceId,
  sourceType,
  evidenceIds = [],
  actorId = null,
  metadata = {}
}) {
  assertObject(object, "object");
  assertString(relationship, "relationship");
  assertString(sourceId, "sourceId");
  assertString(sourceType, "sourceType");
  assertObject(metadata, "metadata");

  if (!Object.values(LINEAGE_RELATIONSHIPS).includes(relationship)) {
    throw new Error(`Unknown lineage relationship: ${relationship}`);
  }

  if (!Array.isArray(evidenceIds)) {
    throw new TypeError("evidenceIds must be an array");
  }

  for (const evidenceId of evidenceIds) {
    assertString(evidenceId, "evidenceId");
  }

  if (actorId !== null) assertString(actorId, "actorId");

  const entry = {
    id: uid("lineage"),
    relationship,
    sourceId,
    sourceType,
    evidenceIds: [...new Set(evidenceIds)],
    actorId,
    metadata: clone(metadata),
    createdAt: now()
  };

  object.lineage = [...(object.lineage ?? []), entry];
  object.version = Number(object.version ?? 0) + 1;
  object.updatedAt = now();

  return entry;
}

export function createEvidence({
  type,
  objectId,
  actorId = null,
  source = null,
  content = null,
  metadata = {}
}) {
  assertString(type, "type");
  assertString(objectId, "objectId");
  assertObject(metadata, "metadata");

  if (!Object.values(EVIDENCE_TYPES).includes(type)) {
    throw new Error(`Unknown evidence type: ${type}`);
  }

  if (actorId !== null) assertString(actorId, "actorId");
  if (source !== null) assertObject(source, "source");

  return {
    id: uid("evidence"),
    type,
    objectId,
    actorId,
    source: source === null ? null : clone(source),
    content: content === null ? null : clone(content),
    metadata: clone(metadata),
    createdAt: now()
  };
}

export function createKernel({
  ownerId = null,
  specialties = [],
  stage = KERNEL_LIFE_STAGES.KERNEL,
  expertise = {},
  evidenceIds = []
} = {}) {
  if (!Array.isArray(specialties)) {
    throw new TypeError("specialties must be an array");
  }

  if (!Object.values(KERNEL_LIFE_STAGES).includes(stage)) {
    throw new Error(`Invalid Kernel life stage: ${stage}`);
  }

  assertObject(expertise, "expertise");

  return createObject({
    type: JESUS_FREAK_TYPES.KERNEL,
    system: SYSTEMS.GARDEN,
    ownerId,
    state: stage,
    data: {
      specialties: [...new Set(specialties.map((value) => assertString(value, "specialty")))],
      expertise: clone(expertise),
      investigations: [],
      contributions: [],
      learned: [],
      failures: [],
      successes: [],
      evidenceIds: [...new Set(evidenceIds)]
    }
  });
}

export function recordKernelExperience(kernel, {
  domain,
  kind,
  summary,
  evidenceIds = [],
  relatedObjectIds = []
}) {
  assertKernel(kernel);
  assertString(domain, "domain");
  assertString(kind, "kind");
  assertString(summary, "summary");

  if (!Array.isArray(evidenceIds) || !Array.isArray(relatedObjectIds)) {
    throw new TypeError("evidenceIds and relatedObjectIds must be arrays");
  }

  const experience = {
    id: uid("experience"),
    domain,
    kind,
    summary,
    evidenceIds: [...new Set(evidenceIds)],
    relatedObjectIds: [...new Set(relatedObjectIds)],
    createdAt: now()
  };

  kernel.data.investigations.push(experience);

  if (kind === "learning") kernel.data.learned.push(experience.id);
  if (kind === "failure") kernel.data.failures.push(experience.id);
  if (kind === "success") kernel.data.successes.push(experience.id);

  kernel.version += 1;
  kernel.updatedAt = now();

  return experience;
}

export function assertKernel(kernel) {
  assertObject(kernel, "kernel");
  if (kernel.type !== JESUS_FREAK_TYPES.KERNEL) throw new Error("Object is not a Kernel");
  if (kernel.system !== SYSTEMS.GARDEN) throw new Error("Kernel must belong to Garden of Apex");
  return true;
}

export function createPopcorn({
  kernelIds = [],
  source = null,
  discoveryContext = {},
  extract = null,
  interpretation = null,
  verification = null,
  evidenceIds = []
} = {}) {
  assertObject(discoveryContext, "discoveryContext");
  if (!Array.isArray(kernelIds)) throw new TypeError("kernelIds must be an array");

  return createObject({
    type: JESUS_FREAK_TYPES.POPCORN,
    system: SYSTEMS.GARDEN,
    state: POPCORN_STATES.DISCOVERED,
    data: {
      source: source === null ? null : clone(source),
      discoveryContext: clone(discoveryContext),
      extract: extract === null ? null : clone(extract),
      interpretation: interpretation === null ? null : clone(interpretation),
      verification: verification === null ? null : clone(verification),
      kernelIds: [...new Set(kernelIds)],
      evaluationIds: [],
      developmentIds: [],
      productionIds: [],
      evidenceIds: [...new Set(evidenceIds)]
    }
  });
}

export function assertPopcorn(popcorn) {
  assertObject(popcorn, "popcorn");
  if (popcorn.type !== JESUS_FREAK_TYPES.POPCORN) throw new Error("Object is not Popcorn");
  if (popcorn.system !== SYSTEMS.GARDEN) throw new Error("Popcorn must belong to Garden of Apex");
  return true;
}

export function createCornNut({
  targetId,
  targetType,
  criteria = {},
  ratings = {},
  reasoning = "",
  evaluatorId = null,
  evidenceIds = []
}) {
  assertString(targetId, "targetId");
  assertString(targetType, "targetType");
  assertObject(criteria, "criteria");
  assertObject(ratings, "ratings");

  if (typeof reasoning !== "string") throw new TypeError("reasoning must be a string");
  if (evaluatorId !== null) assertString(evaluatorId, "evaluatorId");

  return createObject({
    type: JESUS_FREAK_TYPES.CORNNUT,
    system: SYSTEMS.GARDEN,
    state: "evaluated",
    data: {
      targetId,
      targetType,
      criteria: clone(criteria),
      ratings: clone(ratings),
      ratingSystem: "KornPops",
      reasoning,
      evaluatorId,
      evidenceIds: [...new Set(evidenceIds)]
    }
  });
}

export function assertCornNut(cornNut) {
  assertObject(cornNut, "cornNut");
  if (cornNut.type !== JESUS_FREAK_TYPES.CORNNUT) throw new Error("Object is not a CornNut");
  if (cornNut.system !== SYSTEMS.GARDEN) throw new Error("CornNuts must belong to Garden of Apex");
  if (cornNut.data?.ratingSystem !== "KornPops") {
    throw new Error("CornNuts must use the KornPops rating system");
  }
  return true;
}

export function createCob({
  role,
  specialization = null,
  ownerId = null,
  capabilities = [],
  evidenceIds = []
}) {
  assertString(role, "role");
  if (specialization !== null) assertString(specialization, "specialization");
  if (!Array.isArray(capabilities)) throw new TypeError("capabilities must be an array");

  return createObject({
    type: JESUS_FREAK_TYPES.COB,
    system: SYSTEMS.STUDIO,
    ownerId,
    state: "available",
    data: {
      role,
      specialization,
      capabilities: [...new Set(capabilities.map((value) => assertString(value, "capability")))],
      assignments: [],
      evidenceIds: [...new Set(evidenceIds)]
    }
  });
}

export function assertCob(cob) {
  assertObject(cob, "cob");
  if (cob.type !== JESUS_FREAK_TYPES.COB) throw new Error("Object is not a Cob");
  if (cob.system !== SYSTEMS.STUDIO) throw new Error("Cobs must operate within Apex Studio production");
  return true;
}

export function createProtocob({
  popcornId = null,
  title,
  format,
  state = PROTOCOB_STATES.CONCEPT,
  ownerId = null,
  data = {}
}) {
  assertString(title, "title");
  assertString(format, "format");
  assertObject(data, "data");
  if (popcornId !== null) assertString(popcornId, "popcornId");
  if (!Object.values(PROTOCOB_STATES).includes(state)) {
    throw new Error(`Invalid Protocob state: ${state}`);
  }

  return createObject({
    type: JESUS_FREAK_TYPES.PROTOCOB,
    system: SYSTEMS.STUDIO,
    ownerId,
    state,
    parentId: popcornId,
    data: {
      title,
      format,
      script: null,
      story: null,
      characters: [],
      world: null,
      visualReferences: [],
      audio: [],
      scenes: [],
      assets: [],
      renders: [],
      edits: [],
      reviews: [],
      inspections: [],
      releaseMetadata: null,
      ...clone(data)
    }
  });
}

export function assertProtocob(protocob) {
  assertObject(protocob, "protocob");
  if (protocob.type !== JESUS_FREAK_TYPES.PROTOCOB) throw new Error("Object is not a Protocob");
  if (protocob.system !== SYSTEMS.STUDIO) throw new Error("Protocobs must belong to Apex Studio production");
  if (!Object.values(PROTOCOB_STATES).includes(protocob.state)) {
    throw new Error(`Invalid Protocob state: ${protocob.state}`);
  }
  return true;
}

export function canTransition(type, from, to) {
  const graph = type === JESUS_FREAK_TYPES.POPCORN
    ? TRANSITIONS.POPCORN
    : type === JESUS_FREAK_TYPES.PROTOCOB
      ? TRANSITIONS.PROTOCOB
      : null;

  if (!graph || !Object.hasOwn(graph, from)) return false;
  return graph[from].includes(to);
}

export function transitionObject(object, to, {
  evidence = [],
  actorId = null,
  reason = null
} = {}) {
  assertObject(object, "object");
  assertString(to, "to");

  if (!canTransition(object.type, object.state, to)) {
    throw new Error(`Invalid ${object.type} transition: ${object.state} -> ${to}`);
  }

  if (!Array.isArray(evidence)) throw new TypeError("evidence must be an array");
  if (actorId !== null) assertString(actorId, "actorId");

  const normalizedEvidence = evidence.map((item) => {
    if (typeof item === "string") return { id: item, type: null };
    assertObject(item, "evidence item");
    assertString(item.id, "evidence.id");
    return { id: item.id, type: item.type ?? null };
  });

  const transition = {
    id: uid("transition"),
    from: object.state,
    to,
    actorId,
    reason,
    evidence: normalizedEvidence,
    createdAt: now()
  };

  object.state = to;
  object.version = Number(object.version ?? 0) + 1;
  object.updatedAt = now();
  object.data = {
    ...(object.data ?? {}),
    transitions: [...(object.data?.transitions ?? []), transition]
  };

  return transition;
}

export function assertTransitionEvidence({ object, from, to, evidence }) {
  assertObject(object, "object");
  assertString(from, "from");
  assertString(to, "to");
  if (!Array.isArray(evidence)) throw new TypeError("evidence must be an array");

  if (object.state !== to) {
    throw new Error(`Object state ${object.state} does not match transition destination ${to}`);
  }

  const matching = (object.data?.transitions ?? []).find(
    (transition) => transition.from === from && transition.to === to
  );

  if (!matching) throw new Error(`Missing transition evidence for ${object.type}: ${from} -> ${to}`);

  const suppliedIds = new Set(
    evidence.map((item) => typeof item === "string" ? item : item?.id)
  );

  for (const evidenceItem of matching.evidence ?? []) {
    if (!suppliedIds.has(evidenceItem.id)) {
      throw new Error(`Transition evidence ${evidenceItem.id} is not present`);
    }
  }

  return true;
}

export function canDeclareFinished(protocob) {
  assertProtocob(protocob);

  if (protocob.state !== PROTOCOB_STATES.RELEASE_READY &&
      protocob.state !== PROTOCOB_STATES.RELEASED) {
    return false;
  }

  return (protocob.data?.inspections ?? []).some(
    (inspection) =>
      inspection?.authority === WORKER_AUTHORITIES.KING_COB &&
      inspection?.result === "approved" &&
      Array.isArray(inspection?.evidenceIds) &&
      inspection.evidenceIds.length > 0
  );
}

export function assertFinishedProtocob(protocob) {
  assertProtocob(protocob);
  if (!canDeclareFinished(protocob)) {
    throw new Error("Protocob cannot be declared finished without valid King Cob inspection evidence");
  }
  return true;
}

export function createInspection({
  protocobId,
  authority,
  inspectorId,
  result,
  findings = [],
  evidenceIds = []
}) {
  assertString(protocobId, "protocobId");
  assertString(inspectorId, "inspectorId");
  assertString(result, "result");

  if (authority !== WORKER_AUTHORITIES.KING_COB) {
    throw new Error("Only King Cob may provide final Protocob inspection authority");
  }

  if (!["approved", "rejected"].includes(result)) {
    throw new Error(`Invalid inspection result: ${result}`);
  }

  if (!Array.isArray(findings) || !Array.isArray(evidenceIds)) {
    throw new TypeError("findings and evidenceIds must be arrays");
  }

  if (evidenceIds.length === 0) throw new Error("Final inspection requires evidence");

  return {
    id: uid("inspection"),
    protocobId,
    authority,
    inspectorId,
    result,
    findings: clone(findings),
    evidenceIds: [...new Set(evidenceIds)],
    createdAt: now()
  };
}

export function assertReviewerAuthority(authority) {
  if (authority === "gemini") {
    throw new Error("Gemini is a worker/reviewer and cannot provide final production authority");
  }
  return true;
}

export function assertGeminiNotFinalAuthority(authority) {
  if (authority === "gemini") {
    throw new Error("BLACK-PEN violation: Gemini cannot self-certify production readiness");
  }
  return true;
}

export function createWorkerAssignment({
  workerId,
  authority,
  taskType,
  objectId,
  acceptanceCriteria = [],
  evidenceRequired = [],
  leaseId = null
}) {
  assertString(workerId, "workerId");
  assertString(authority, "authority");
  assertString(taskType, "taskType");
  assertString(objectId, "objectId");

  if (!Array.isArray(acceptanceCriteria) || !Array.isArray(evidenceRequired)) {
    throw new TypeError("acceptanceCriteria and evidenceRequired must be arrays");
  }

  if (leaseId !== null) assertString(leaseId, "leaseId");

  return {
    id: uid("assignment"),
    workerId,
    authority,
    taskType,
    objectId,
    acceptanceCriteria: clone(acceptanceCriteria),
    evidenceRequired: clone(evidenceRequired),
    leaseId,
    status: "assigned",
    createdAt: now(),
    updatedAt: now()
  };
}

export function assertWorkerCanOperateOnObject({
  workerAuthority,
  object,
  operation,
  finalAuthority = false
}) {
  assertString(workerAuthority, "workerAuthority");
  assertObject(object, "object");
  assertString(operation, "operation");

  if (finalAuthority && workerAuthority !== WORKER_AUTHORITIES.KING_COB) {
    throw new Error("Only King Cob may exercise final production inspection authority");
  }

  if (workerAuthority === WORKER_AUTHORITIES.KERNEL &&
      object.system !== SYSTEMS.GARDEN) {
    throw new Error("Kernel authority cannot own Studio production objects");
  }

  if (workerAuthority === WORKER_AUTHORITIES.CORNNUT &&
      object.system !== SYSTEMS.GARDEN) {
    throw new Error("CornNut authority cannot own Studio production objects");
  }

  if (workerAuthority === WORKER_AUTHORITIES.COB &&
      object.type !== JESUS_FREAK_TYPES.PROTOCOB &&
      object.system !== SYSTEMS.STUDIO) {
    throw new Error("Cob production authority cannot mutate Garden ownership");
  }

  if (workerAuthority === WORKER_AUTHORITIES.REVIEWER &&
      operation === "final_inspection") {
    throw new Error("Reviewer authority cannot perform final inspection");
  }

  return true;
}

export function createDevelopmentRecord({
  popcornId,
  perspective,
  contributorIds = [],
  findings = [],
  experiments = [],
  risks = [],
  readiness = "not_ready",
  evidenceIds = []
}) {
  assertString(popcornId, "popcornId");
  assertString(perspective, "perspective");

  if (!Array.isArray(contributorIds) ||
      !Array.isArray(findings) ||
      !Array.isArray(experiments) ||
      !Array.isArray(risks) ||
      !Array.isArray(evidenceIds)) {
    throw new TypeError("development collections must be arrays");
  }

  if (!["not_ready", "developing", "ready"].includes(readiness)) {
    throw new Error(`Invalid development readiness: ${readiness}`);
  }

  return {
    id: uid("development"),
    popcornId,
    perspective,
    contributorIds: [...new Set(contributorIds)],
    findings: clone(findings),
    experiments: clone(experiments),
    risks: clone(risks),
    readiness,
    evidenceIds: [...new Set(evidenceIds)],
    createdAt: now(),
    updatedAt: now()
  };
}

export function assertDevelopmentReadiness(record) {
  assertObject(record, "record");

  if (record.readiness !== "ready") {
    throw new Error("Development record is not ready for production commitment");
  }

  if (!Array.isArray(record.evidenceIds) || record.evidenceIds.length === 0) {
    throw new Error("Development readiness requires evidence");
  }

  return true;
}

export function assertNoFourthSystem(value) {
  if (value === null || value === undefined) return true;

  if (typeof value === "string") {
    if (value === "special-search-system" ||
        value === "garden-special-search" ||
        value === "toonx-system") {
      throw new Error(`BLACK-PEN violation: ${value} would create a forbidden fourth system`);
    }
    return true;
  }

  if (Array.isArray(value)) {
    for (const item of value) assertNoFourthSystem(item);
    return true;
  }

  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key === "system" && typeof child === "string") assertSystem(child);
      if (key === "systems" && Array.isArray(child)) {
        for (const system of child) assertSystem(system);
      }
      assertNoFourthSystem(child);
    }
  }

  return true;
}

export function validateObject(object) {
  assertObject(object, "object");
  assertString(object.id, "object.id");
  assertString(object.type, "object.type");
  assertSystem(object.system);

  if (object.type === JESUS_FREAK_TYPES.KERNEL) assertKernel(object);
  if (object.type === JESUS_FREAK_TYPES.POPCORN) assertPopcorn(object);
  if (object.type === JESUS_FREAK_TYPES.CORNNUT) assertCornNut(object);
  if (object.type === JESUS_FREAK_TYPES.COB) assertCob(object);
  if (object.type === JESUS_FREAK_TYPES.PROTOCOB) assertProtocob(object);

  assertNoFourthSystem(object);
  return true;
}

export function validateLineage(object, registry) {
  assertObject(object, "object");

  if (!(registry instanceof Map)) {
    throw new TypeError("registry must be a Map");
  }

  for (const entry of object.lineage ?? []) {
    assertString(entry.sourceId, "lineage.sourceId");

    const source = registry.get(entry.sourceId);
    if (!source) {
      throw new Error(`Broken lineage: source ${entry.sourceId} does not exist`);
    }

    assertString(entry.relationship, "lineage.relationship");

    if (entry.relationship === LINEAGE_RELATIONSHIPS.PRODUCED_FROM &&
        source.type !== JESUS_FREAK_TYPES.POPCORN) {
      throw new Error("Production lineage must remain traceable to the originating Popcorn");
    }
  }

  return true;
}

export function validateFinishedProduction({
  protocob,
  registry,
  requiredEvidenceTypes = [
    EVIDENCE_TYPES.SCRIPTURE,
    EVIDENCE_TYPES.ASSET,
    EVIDENCE_TYPES.REVIEW,
    EVIDENCE_TYPES.INSPECTION
  ]
}) {
  assertProtocob(protocob);

  if (!(registry instanceof Map)) {
    throw new TypeError("registry must be a Map");
  }

  if (protocob.state !== PROTOCOB_STATES.RELEASE_READY &&
      protocob.state !== PROTOCOB_STATES.RELEASED) {
    throw new Error("Production is not in a finished-capable state");
  }

  validateLineage(protocob, registry);

  if (!Array.isArray(protocob.data?.inspections) ||
      protocob.data.inspections.length === 0) {
    throw new Error("Production requires inspection records");
  }

  const finalInspection = protocob.data.inspections.find(
    (inspection) =>
      inspection.authority === WORKER_AUTHORITIES.KING_COB &&
      inspection.result === "approved"
  );

  if (!finalInspection) {
    throw new Error("Production requires approved King Cob inspection");
  }

  const evidence = new Set(finalInspection.evidenceIds ?? []);

  for (const evidenceType of requiredEvidenceTypes) {
    const exists = [...evidence].some((id) => registry.get(id)?.type === evidenceType);
    if (!exists) throw new Error(`Missing required production evidence: ${evidenceType}`);
  }

  return true;
}

export function getOwnershipMap() {
  return Object.fromEntries(
    Object.entries(OWNERSHIP).map(([system, capabilities]) => [system, [...capabilities]])
  );
}

export function getTerminalStates() {
  return [...TERMINAL_STATES];
}
