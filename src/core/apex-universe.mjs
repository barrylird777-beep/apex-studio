/**
 * Apex universe capability contract.
 *
 * Six user-facing Apex surfaces share the same capability ceiling.
 * Domain ownership remains separate; capabilities are universal.
 */
export const APEX_SURFACES = Object.freeze({
  KORNKNOB: {
    id: "KORNKNOB",
    role: "ears",
    domain: "music, sound, audio discovery, analysis and intelligence"
  },
  APEX_STUDIOS: {
    id: "ApexStudios",
    role: "eyes",
    domain: "production, visual direction, video, media operations and distribution"
  },
  GARDEN_OF_APEX: {
    id: "GardenOfApex",
    role: "brain",
    domain: "Korn World, scripture, research, knowledge and study"
  },
  ENGINE_APEX: {
    id: "EngineApex",
    role: "money",
    domain: "opportunity discovery, growth, business, monetization and decision intelligence"
  },
  APEXUS: {
    id: "Apexus",
    role: "network",
    domain: "24/7 original animated entertainment network, programming, broadcast and audience experience"
  },
  SHIELD_APEX: {
    id: "ShieldApex",
    role: "shield",
    domain: "network, security and execution-environment protection"
  }
});

export const APEX_UNIVERSAL_CAPABILITIES = Object.freeze([
  "local_ai",
  "cloud_ai",
  "scripture_research",
  "music_intelligence",
  "visual_generation",
  "audio_generation",
  "video_generation",
  "media_processing",
  "trend_intelligence",
  "orchestration",
  "automation",
  "analytics",
  "storage",
  "provenance",
  "monetization",
  "network_protection"
]);

export const APEX_EXECUTION_POLICY = Object.freeze({
  localPreferred: true,
  offlineInferenceSupported: true,
  networkInferenceRequired: false,
  telemetryDefault: false,
  providerQuotaBypass: false,
  billingBypass: false,
  accountAbuse: false,
  unrestrictedIosDaemon: false,
  domainIsolation: true
});

export function surface(id) {
  return Object.values(APEX_SURFACES).find(item => item.id === String(id)) ?? null;
}

export function capabilityAllowed(id) {
  return APEX_UNIVERSAL_CAPABILITIES.includes(String(id));
}

export function buildApexExecutionEnvelope(input = {}) {
  const requested = Array.isArray(input.capabilities)
    ? input.capabilities.map(String).filter(capabilityAllowed)
    : [...APEX_UNIVERSAL_CAPABILITIES];

  return {
    surface: surface(input.surface)?.id ?? String(input.surface || "Apex"),
    capabilities: [...new Set(requested)],
    localPreferred: input.localPreferred !== false,
    requireOffline: input.requireOffline === true,
    provenanceRequired: true,
    createdAt: new Date().toISOString()
  };
}
