import crypto from "node:crypto";

export const PRIVACY_DEFAULTS=Object.freeze({
  telemetry:false,
  remoteProviders:false,
  remoteSync:false,
  crashReporting:false,
  localOnly:true
});

export function createPrivacyPolicy(input={}){
  const envRemote=process.env.APEX_ALLOW_REMOTE_PROVIDERS==="true";
  // Caller-supplied options may add descriptive fields, but cannot silently
  // turn on telemetry, crash reporting, sync, or remote providers.
  return {
    version:1,
    ...input,
    ...PRIVACY_DEFAULTS,
    remoteProviders:envRemote,
    localOnly:!envRemote,
    updatedAt:new Date().toISOString()
  };
}

export function fingerprint(value){
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function isSensitiveKey(key,keys){
  const normalized=String(key).replace(/([a-z0-9])([A-Z])/g,"$1_$2").toLowerCase();
  const parts=normalized.split(/[^a-z0-9]+/).filter(Boolean);
  if(keys.some(candidate=>normalized===String(candidate).replace(/([a-z0-9])([A-Z])/g,"$1_$2").toLowerCase())) return true;
  const sensitiveWords=new Set(["token","password","passwd","secret","authorization","credential","jwt","cookie"]);
  const benignTokenSuffixes=new Set(["in","out","address","symbol","id","name","type","amount","price","decimals","count","contract","chain"]);
  if(parts[0]==="token" && parts.length>1 && benignTokenSuffixes.has(parts[1]) && !parts.some(part=>["password","passwd","secret","authorization","credential","jwt","cookie"].includes(part))) return false;
  if(parts.some(part=>sensitiveWords.has(part))) return true;
  const pairs=new Set(["api_key","private_key","client_secret","access_key","refresh_key","signing_key","encryption_key","session_key"]);
  for(let i=0;i<parts.length-1;i++) if(pairs.has(parts[i]+"_"+parts[i+1])) return true;
  return parts.some(part=>["apikey","privatekey","clientsecret","accesskey","refreshkey","signingkey","encryptionkey","sessionkey"].includes(part));
}

function redactInlineSecrets(value){
  return value
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/(["']?\b(?:api[ _-]?key|access[ _-]?token|refresh[ _-]?token|client[ _-]?secret|private[ _-]?key|signing[ _-]?key|encryption[ _-]?key|session[ _-]?key|token|password|passwd|authorization|credential|secret|jwt|cookie)\b["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&}]+)/gi, "$1[REDACTED]");
}

export function redact(value,keys=["token","password","secret","apiKey","authorization"]){
  if(typeof value==="string") return redactInlineSecrets(value);
  if(Array.isArray(value)) return value.map(v=>redact(v,keys));
  if(value&&typeof value==="object"){
    return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,isSensitiveKey(k,keys)?"[REDACTED]":redact(v,keys)]));
  }
  return value;
}

/**
 * Data-product governance primitives. Metadata checks are not a substitute for
 * authentication, enforceable storage/query ACLs, or legal review.
 */
const DATA_CLASSIFICATIONS = new Set(["public", "internal", "confidential", "restricted"]);
const DATA_PURPOSES = new Set(["personal", "product", "analytics", "research", "commercial-sale", "support"]);

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validIsoDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function validateDataProductManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { valid: false, errors: ["manifest must be an object"] };
  }
  for (const key of ["datasetId", "ownerTenantId", "appNamespace", "title", "source", "schemaVersion"]) {
    if (!nonEmptyString(manifest[key])) errors.push(key + " is required");
  }
  if (!DATA_CLASSIFICATIONS.has(manifest.classification)) errors.push("classification is invalid");
  if (!manifest.provenance || !nonEmptyString(manifest.provenance.sourceType) || !validIsoDate(manifest.provenance.collectedAt)) {
    errors.push("provenance.sourceType and valid provenance.collectedAt are required");
  }
  if (!manifest.license || !nonEmptyString(manifest.license.id) ||
      typeof manifest.license.commercialUse !== "boolean" ||
      typeof manifest.license.redistribution !== "boolean") {
    errors.push("license id, commercialUse, and redistribution are required");
  }
  if (!manifest.retention || !validIsoDate(manifest.retention.expiresAt)) {
    errors.push("retention.expiresAt must be a valid date");
  }
  if (typeof manifest.personalData !== "boolean") errors.push("personalData must be explicit");
  if (manifest.personalData && (!manifest.consent || !nonEmptyString(manifest.consent.purpose) ||
      !["granted", "not-required"].includes(manifest.consent.status))) {
    errors.push("personal data requires explicit consent status and purpose");
  }
  return { valid: errors.length === 0, errors };
}

export function evaluateDataProductAccess(manifest, request = {}, now = new Date()) {
  const validation = validateDataProductManifest(manifest);
  const result = (status, reason, choices = ["request-access", "review-source-rights", "stop"], extra = {}) =>
    ({ status, reason, choices: [...choices], ...extra });

  if (!validation.valid) return result("blocked", "manifest-invalid", ["fix-manifest", "stop"], { errors: validation.errors });
  if (!nonEmptyString(request.tenantId) || request.tenantId !== manifest.ownerTenantId) {
    return result("blocked", "tenant-isolation");
  }
  if (!nonEmptyString(request.appNamespace) || request.appNamespace !== manifest.appNamespace) {
    return result("blocked", "app-namespace-isolation");
  }
  if (!DATA_PURPOSES.has(request.purpose)) {
    return result("needs_review", "purpose-must-be-declared", ["declare-purpose", "stop"]);
  }
  if (Date.parse(manifest.retention.expiresAt) <= now.getTime()) {
    return result("blocked", "retention-expired", ["renew-retention-if-authorized", "delete-or-quarantine", "stop"]);
  }
  if (request.purpose === "commercial-sale" && (!manifest.license.commercialUse || !manifest.license.redistribution)) {
    return result("blocked", "license-does-not-authorize-commercial-redistribution", ["obtain-commercial-rights", "exclude-dataset", "stop"]);
  }
  if (manifest.personalData && !["granted", "not-required"].includes(manifest.consent.status)) {
    return result("blocked", "personal-data-consent-not-established", ["establish-valid-consent-or-legal-basis", "exclude-personal-data", "stop"]);
  }
  if (["confidential", "restricted"].includes(manifest.classification) &&
      (!nonEmptyString(manifest.accessGrantId) || request.grantId !== manifest.accessGrantId)) {
    return result("needs_review", "explicit-data-owner-grant-required", ["request-owner-grant", "use-authorized-aggregate", "stop"]);
  }
  return result("allowed", "manifest-policy-checks-passed", ["proceed", "stop"], {
    disclaimer: "Metadata checks passed; serving-layer identity, grants, licensing and row/object ACLs must still be enforced."
  });
}

export function createDataProductReceipt({ datasetId, tenantId, appNamespace, action, actorId, purpose, sourceRefs = [], policyVersion = "1" } = {}) {
  for (const [key, value] of Object.entries({ datasetId, tenantId, appNamespace, action, actorId, purpose })) {
    if (!nonEmptyString(value)) throw new TypeError(key + " is required for a data-product receipt");
  }
  if (!Array.isArray(sourceRefs) || sourceRefs.some(ref => !nonEmptyString(ref))) {
    throw new TypeError("sourceRefs must be an array of non-empty source references");
  }
  return Object.freeze({
    datasetId, tenantId, appNamespace, action, actorId, purpose,
    sourceRefs: [...sourceRefs], policyVersion, recordedAt: new Date().toISOString()
  });
}
