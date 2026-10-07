export const APEX_UNIVERSAL_CAPABILITIES = Object.freeze([
  "ai",
  "scripture",
  "visual",
  "audio",
  "video",
  "orchestration"
]);

export const APEX_LOCAL_POLICY = Object.freeze({
  preferred: "local",
  cloudRequired: false,
  telemetry: false,
  networkInferenceRequired: false,
  providerQuotaBypass: false,
  accountAbuse: false,
  permanentIosDaemon: false
});

export function normalizeApexCapability(value) {
  const id = String(value || "").trim().toLowerCase();
  return APEX_UNIVERSAL_CAPABILITIES.includes(id) ? id : "ai";
}

export function buildUniversalExecutionEnvelope(input = {}) {
  return {
    capability: normalizeApexCapability(input.capability),
    request: String(input.request || input.prompt || "").slice(0, 20000),
    execution: {
      localPreferred: true,
      cloudFallbackAllowed: input.cloudFallbackAllowed !== false,
      requireOffline: input.requireOffline === true
    },
    provenance: {
      source: String(input.source || "apex").slice(0, 500),
      originalExpressionRequired: true
    },
    createdAt: new Date().toISOString()
  };
}
