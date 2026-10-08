/** Canonical Apex system and surface boundary. */
export const APEX_SYSTEMS = Object.freeze({
  APEX_STUDIO: { id: "apex-studio", domain: "production, social, network/infrastructure, Special Search" },
  GARDEN_OF_APEX: { id: "garden-of-apex", domain: "knowledge, research and creative ecosystem" },
  KORNKNOB: { id: "kornknob", domain: "AI, model, media and computational capability" }
});

export const APEX_SURFACES = Object.freeze({
  TOONX: { id: "toonx", owner: "apex-studio", domain: "original animated entertainment production and audience experience" },
  SPECIAL_SEARCH: { id: "special-search", owner: "apex-studio", domain: "specialized search" }
});

export const APEX_UNIVERSAL_CAPABILITIES = Object.freeze([
  "local_ai","cloud_ai","scripture_research","music_intelligence","visual_generation",
  "audio_generation","video_generation","media_processing","trend_intelligence",
  "orchestration","automation","analytics","storage","provenance","monetization","network_protection"
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
  domainIsolation: true,
  artificialExecutionCeilings: false
});

export function system(id) {
  return Object.values(APEX_SYSTEMS).find(item => item.id === String(id)) ?? null;
}

export function surface(id) {
  return Object.values(APEX_SURFACES).find(item => item.id === String(id)) ?? null;
}

export function capabilityAllowed(id) {
  return APEX_UNIVERSAL_CAPABILITIES.includes(String(id));
}

export function assertCanonicalBoundary(value) {
  if (!value || typeof value !== "object") throw new TypeError("Apex boundary value must be an object");
  if (value.system && !system(value.system)) throw new Error("Unknown Apex system: " + value.system);
  if (value.surface && !surface(value.surface)) throw new Error("Unknown Apex surface: " + value.surface);
  if (value.surface === "special-search" && value.system !== "apex-studio") {
    throw new Error("Special Search belongs permanently to Apex Studio");
  }
  return true;
}

export function buildApexExecutionEnvelope(input = {}) {
  const requested = Array.isArray(input.capabilities)
    ? input.capabilities.map(String).filter(capabilityAllowed)
    : [...APEX_UNIVERSAL_CAPABILITIES];
  const selectedSurface = surface(input.surface);
  const selectedSystem = system(input.system || selectedSurface?.owner);
  if (input.system && !selectedSystem) throw new Error("Unknown Apex system: " + input.system);
  if (selectedSurface && selectedSystem && selectedSurface.owner !== selectedSystem.id) {
    throw new Error("Surface is owned by a different Apex system");
  }
  return {
    system: selectedSystem?.id ?? null,
    surface: selectedSurface?.id ?? null,
    capabilities: [...new Set(requested)],
    localPreferred: input.localPreferred !== false,
    requireOffline: input.requireOffline === true,
    provenanceRequired: true,
    createdAt: new Date().toISOString()
  };
}
