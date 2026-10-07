/**
 * Apex universe capability contract.
 *
 * Six user-facing Apex surfaces share the same capability ceiling.
 * Domain ownership remains separate; capabilities are universal.
 */
export const APEX_SURFACES = Object.freeze({
  KORNKNOB: {
    id: "KORNKNOB",
    aliasOf: "KORNKOB",
    role: "ears",
    domain: "music, sound, audio discovery, analysis and intelligence"
  },
  KORNKOB: {
    id: "KORNKOB",
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
  APEX_OPPORTUNITY: {
    id: "ApexOpportunity",
    role: "money",
    domain: "opportunity discovery, growth, monetization and business intelligence"
  },
  APEX_RAPID_VIDEO: {
    id: "ApexRapidVideo",
    role: "money",
    domain: "rapid paid video creation and fulfillment"
  },
  APEX_ENGINE: {
    id: "ApexEngine",
    role: "money",
    domain: "reusable revenue systems, automation, products and business infrastructure"
  },
  APEX_AD_BLOCKER: {
    id: "ApexAdBlocker",
    role: "shield",
    domain: "network protection and ad blocking"
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
  "search_anything",
  "unbounded_web_research",
  "storage",
  "provenance",
  "monetization",
  "network_protection",
  "music_model_intelligence",
  "social_analytics",
  "commerce_automation",
  "persistent_adblocking",
  "surface_orchestration"
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
