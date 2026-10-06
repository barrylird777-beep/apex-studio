/**
 * Apex master architecture contracts.
 *
 * GardenOfApex = knowledge/research brain.
 * Apex Studio = production/network/distribution system.
 * KORN-KNOB = AI model and media capability layer.
 *
 * Durable state belongs in PostgreSQL; this module defines boundaries/contracts.
 */
export const ARCHITECTURE_VERSION = "apex-master-architecture.v1";

export const SYSTEMS = Object.freeze({
  GARDEN: "garden-of-apex",
  STUDIO: "apex-studio",
  KORN_KNOB: "korn-knob"
});

export const OWNERSHIP = Object.freeze({
  [SYSTEMS.GARDEN]: Object.freeze([
    "knowledge","research","bible-research","korn-world",
    "korn-world-studies","ai-chat-lab","research-conversations","world-analytics"
  ]),
  [SYSTEMS.STUDIO]: Object.freeze([
    "production","movie-direction","video-lab","imagery-lab","audio-lab",
    "ai-creation-lab","editing","rendering","quality-control",
    "social-media-command","network","infrastructure"
  ]),
  [SYSTEMS.KORN_KNOB]: Object.freeze([
    "ai-models","model-discovery","model-routing","model-evaluation",
    "media-ai","audio-ai","music-ai","image-ai","video-ai","voice-ai",
    "multimodal-ai","provider-access"
  ])
});

export const CAPABILITY_KINDS = Object.freeze([
  "llm","vision","image","video","audio","music","voice","multimodal",
  "embedding","reranker","tool","api","software","dataset","renderer"
]);

export const STUDIO_SURFACES = Object.freeze([
  "video-lab","imagery-lab","audio-lab","ai-creation-lab",
  "movie-direction","social-media-command"
]);

export const JOB_TYPES = Object.freeze([
  "capability-discovery","capability-health","ai-execution",
  "garden-research","garden-chat","korn-world-study","movie-direction",
  "video-production","image-production","audio-production","media-qc",
  "social-research","social-analysis","social-plan","release-preparation"
]);

export const EVIDENCE_STATES = Object.freeze([
  "KNOWN","OBSERVED","INFERRED","UNKNOWN"
]);

const OWNER_BY_DOMAIN = new Map(
  Object.entries(OWNERSHIP).flatMap(([system, domains]) =>
    domains.map(domain => [domain, system])
  )
);

export function ownerOf(domain) {
  const owner = OWNER_BY_DOMAIN.get(String(domain));
  if (!owner) throw new Error(`Unknown architecture domain: ${domain}`);
  return owner;
}

export function assertOwner(system, domain) {
  const expected = ownerOf(domain);
  if (expected !== system) {
    throw new Error(
      `Ownership violation: ${system} cannot own ${domain}; owner is ${expected}`
    );
  }
  return true;
}

export function assertStudioNetworkOwnership(actor) {
  return assertOwner(actor, "network");
}

export function assertKornKnobModelOwnership(actor) {
  return assertOwner(actor, "ai-models");
}

export function assertGardenKnowledgeOwnership(actor) {
  return assertOwner(actor, "knowledge");
}

export function createCapability(input = {}) {
  const kind = String(input.kind || "").trim();
  const provider = String(input.provider || "").trim();
  const model = input.model == null ? null : String(input.model).trim();
  if (!CAPABILITY_KINDS.includes(kind)) throw new Error(`Unsupported capability kind: ${kind}`);
  if (!provider) throw new Error("Capability provider is required");

  return Object.freeze({
    schemaVersion: "apex-capability.v1",
    capabilityId: String(input.capabilityId || `${provider}:${kind}:${model || "service"}`),
    owner: SYSTEMS.KORN_KNOB,
    kind, provider, model,
    capabilities: [...new Set((input.capabilities || []).map(String))],
    cost: input.cost ?? null,
    latencyClass: input.latencyClass ?? null,
    limits: input.limits ?? {},
    licensing: input.licensing ?? null,
    health: input.health ?? "unknown",
    version: input.version ?? null,
    metadata: input.metadata ?? {}
  });
}

export function createCapabilityRequest(input = {}) {
  const requester = String(input.requester || SYSTEMS.STUDIO);
  const surface = String(input.surface || "").trim();
  const kind = String(input.kind || "").trim();
  if (requester === SYSTEMS.STUDIO && !STUDIO_SURFACES.includes(surface)) {
    throw new Error(`Unknown Studio creative surface: ${surface}`);
  }
  if (!CAPABILITY_KINDS.includes(kind)) throw new Error(`Unsupported capability kind: ${kind}`);

  return Object.freeze({
    schemaVersion: "apex-capability-request.v1",
    requestId: String(input.requestId || randomId()),
    requester,
    capabilityOwner: SYSTEMS.KORN_KNOB,
    surface: surface || null,
    kind,
    requirements: input.requirements ?? {},
    constraints: input.constraints ?? {},
    provenance: input.provenance ?? null,
    createdAt: input.createdAt || new Date().toISOString()
  });
}

export function classifyEvidence(value, evidence = {}) {
  if (evidence.known === true) return "KNOWN";
  if (evidence.observed === true) return "OBSERVED";
  if (evidence.inferred === true) return "INFERRED";
  if (value == null || value === "") return "UNKNOWN";
  return "INFERRED";
}

export function createResearchFinding(input = {}) {
  return Object.freeze({
    schemaVersion: "garden-research-finding.v1",
    findingId: String(input.findingId || randomId()),
    question: String(input.question || ""),
    value: input.value ?? null,
    evidenceState: EVIDENCE_STATES.includes(input.evidenceState)
      ? input.evidenceState
      : classifyEvidence(input.value, input.evidence),
    sources: Array.isArray(input.sources) ? input.sources : [],
    observedAt: input.observedAt || null,
    inferredFrom: Array.isArray(input.inferredFrom) ? input.inferredFrom : [],
    verifiedAt: input.verifiedAt || null
  });
}

export function createProductionPlan(input = {}) {
  const contentDomain = ["bible","korn","original"].includes(input.contentDomain)
    ? input.contentDomain : "original";
  return Object.freeze({
    schemaVersion: "studio-production-plan.v1",
    projectId: String(input.projectId || randomId()),
    contentDomain,
    stages: [
      "idea","directorial-plan","story","script","scenes","shot-plan",
      "visual-direction","audio-direction","asset-creation","edit",
      "qc","render","release"
    ],
    retention: {
      required: true,
      openingHookSeconds: 30,
      objective: "compelling opening that maximizes viewer retention"
    },
    gardenDependencies: input.gardenDependencies ?? [],
    capabilityRequests: input.capabilityRequests ?? [],
    provenance: input.provenance ?? null
  });
}

export function createSocialCommand(input = {}) {
  return Object.freeze({
    schemaVersion: "studio-social-command.v1",
    loop: [
      "DATA","ANALYSIS","EVALUATION","OPPORTUNITIES",
      "PLAN","PRODUCTION","RELEASE","MEASURE","LEARN"
    ],
    platforms: input.platforms ?? [],
    metrics: input.metrics ?? ["retention","engagement","ctr"],
    opportunities: input.opportunities ?? [],
    plan: input.plan ?? null,
    provenance: input.provenance ?? null
  });
}

function randomId() {
  return globalThis.crypto?.randomUUID?.()
    || `apex-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
