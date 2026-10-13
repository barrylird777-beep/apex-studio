import { createHash, randomBytes } from "node:crypto";

const PROVIDERS = Object.freeze({
  openai: { hosts: new Set(["api.openai.com"]), keyEnv: "OPENAI_API_KEY", path: "/v1/chat/completions" },
  anthropic: { hosts: new Set(["api.anthropic.com"]), keyEnv: "ANTHROPIC_API_KEY", path: "/v1/messages" },
  gemini: { hosts: new Set(["generativelanguage.googleapis.com"]), keyEnv: "GEMINI_API_KEY", path: "/v1beta/openai/chat/completions" }
});
const SECRET_KEY = /(?:api[_-]?key|secret|token|password|credential|database[_-]?url|stripe|private[_-]?key|authorization)/i;
const SECRET_VALUE = /(?:Bearer\s+[A-Za-z0-9._~+\/-]{20,}|sk-[A-Za-z0-9_-]{16,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|rk_(?:live|test)_[A-Za-z0-9]{16,}|AIza[\w-]{25,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[A-Z0-9]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|postgres(?:ql)?:\/\/[^\s"'<>]+|mysql:\/\/[^\s"'<>]+)/i;
const ID_KEY = /(?:user_?id|email|phone|app_?id|account_?id|customer_?id|device_?id)/i;

export class OutboundPolicyError extends Error {
  constructor(message, code = "OUTBOUND_POLICY_BLOCK") { super(message); this.name = "OutboundPolicyError"; this.code = code; }
}
const sha = value => createHash("sha256").update(String(value)).digest("hex");
const isPlainObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

function scrubString(value, sessionMap) {
  const candidates = [value];
  // Inspect bearer-form and base64-wrapped strings before permitting egress.
  const bearer = value.match(/\bBearer\s+([A-Za-z0-9._~+\/-]{20,}={0,2})/i);
  if (bearer) candidates.push(bearer[1]);
  const encoded = value.match(/[A-Za-z0-9+/]{24,}={0,2}/g) || [];
  for (const token of encoded.slice(0, 20)) {
    try {
      const decoded = Buffer.from(token, "base64").toString("utf8");
      if (decoded && /^[\x20-\x7E\r\n\t]+$/.test(decoded)) candidates.push(decoded);
    } catch {}
  }
  const extendedCredential = /(?:^|\s)(?:Bearer\s+)?(?:xai-[A-Za-z0-9_-]{20,}|hf_[A-Za-z0-9]{20,}|glpat-[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9_-]{20,}|pypi-[A-Za-z0-9_-]{20,}|ya29\.[A-Za-z0-9_-]{20,})/i;
  if (candidates.some(candidate => SECRET_VALUE.test(candidate) || extendedCredential.test(candidate))) {
    throw new OutboundPolicyError("Payload contains a credential-like value; outbound request blocked.", "SECRET_DETECTED");
  }
  return value;
}
function sanitize(value, sessionMap, key = "") {
  if (typeof value === "string") return scrubString(value, sessionMap);
  if (Array.isArray(value)) return value.map(v => sanitize(v, sessionMap));
  if (!isPlainObject(value)) return value;
  const out = Object.create(null);
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEY.test(k)) {
      if (v !== null && v !== undefined && v !== "") throw new OutboundPolicyError("Payload contains a secret-bearing field: " + k, "SECRET_FIELD_DETECTED");
      continue;
    }
    if (ID_KEY.test(k) && v !== null && v !== undefined && String(v) !== "") {
      const original = String(v);
      if (!sessionMap.has(original)) sessionMap.set(original, "session_" + sha(sessionMap.salt + ":" + original).slice(0, 20));
      out[k] = sessionMap.get(original);
    } else out[k] = sanitize(v, sessionMap, k);
  }
  return out;
}
function makeSessionMap() {
  const map = new Map();
  map.salt = randomBytes(32).toString("hex");
  return map;
}

export function sanitizeOutboundPayload(payload, { bypass = false } = {}) {
  if (!isPlainObject(payload)) throw new TypeError("Outbound payload must be a plain object.");
  // Bypass may preserve identifiers for a deliberately scoped debugging call, but never sends detected secrets.
  if (bypass) {
    const serialized = JSON.stringify(payload);
    if (SECRET_VALUE.test(serialized) || Object.entries(payload).some(([k, v]) => SECRET_KEY.test(k) && v)) {
      throw new OutboundPolicyError("Developer bypass cannot transmit credentials or secret-bearing fields.", "BYPASS_SECRET_BLOCK");
    }
    return structuredClone(payload);
  }
  return sanitize(payload, makeSessionMap());
}

export function validateProviderTarget(provider, url) {
  const config = PROVIDERS[provider];
  if (!config) throw new OutboundPolicyError("Unknown provider.", "UNKNOWN_PROVIDER");
  const target = new URL(url);
  if (target.protocol !== "https:" || !config.hosts.has(target.hostname) || target.username || target.password) {
    throw new OutboundPolicyError("Provider target is not on the HTTPS allowlist.", "TARGET_NOT_ALLOWED");
  }
  return { config, target };
}

/**
 * Stateless outbound gateway. No files, databases, logs, or local queues are created.
 * The caller supplies the local model adapter and owns any persistence explicitly.
 */
export function createSovereignLlmGateway({ fetchImpl = globalThis.fetch, localGenerate, env = process.env } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation required");
  if (typeof localGenerate !== "function") throw new TypeError("localGenerate adapter required");
  return Object.freeze({
    async chat({ provider = "local", payload, signal, debugPreserveIdentifiers = false } = {}) {
      if (provider === "local") return localGenerate(payload, { signal });
      const cfg = PROVIDERS[provider];
      if (!cfg) throw new OutboundPolicyError("Unknown provider.", "UNKNOWN_PROVIDER");
      const apiKey = env[cfg.keyEnv];
      if (!apiKey) return localGenerate(payload, { signal, fallbackReason: "provider_key_missing" });
      const clean = sanitizeOutboundPayload(payload, { bypass: debugPreserveIdentifiers });
      const base = env[provider.toUpperCase() + "_API_BASE"] || (
        provider === "openai" ? "https://api.openai.com" :
        provider === "anthropic" ? "https://api.anthropic.com" :
        "https://generativelanguage.googleapis.com"
      );
      let target;
      try {
        target = validateProviderTarget(provider, new URL(cfg.path, base).toString()).target;
      } catch (error) {
        if (error instanceof OutboundPolicyError) throw error;
        throw new OutboundPolicyError("Invalid provider base URL.", "INVALID_PROVIDER_URL");
      }
      const headers = provider === "anthropic"
        ? { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
        : { "content-type": "application/json", authorization: "Bearer " + apiKey };
      try {
        const guardedFetch = createGuardedFetch([...cfg.hosts], fetchImpl);
        const response = await guardedFetch(target, { method: "POST", headers, body: JSON.stringify(clean), signal });
        if (response.status === 429 || response.status >= 500 || response.status === 408) {
          return localGenerate(payload, { signal, fallbackReason: "provider_http_" + response.status });
        }
        if (!response.ok) throw new OutboundPolicyError("Provider rejected request (HTTP " + response.status + ").", "PROVIDER_REJECTED");
        return { provider, response: await response.json(), trusted: false };
      } catch (error) {
        if (error instanceof OutboundPolicyError) throw error;
        return localGenerate(payload, { signal, fallbackReason: "provider_unreachable" });
      }
    }
  });
}

/** Hash a proposed change for integrity checks; a hash alone is not proof of trust or approval. */
export function hashStagedChange(value) {
  const canonical = typeof value === "string" ? value : JSON.stringify(value);
  return "sha256:" + sha(canonical);
}

/** Requires caller-supplied approval and expected digest before any app applies a proposal. */
export function validateStagedChange({ value, expectedDigest, approved = false, app, allowedApps } = {}) {
  if (!Array.isArray(allowedApps) || !allowedApps.includes(app)) throw new OutboundPolicyError("Unknown application namespace.", "APP_NAMESPACE_REJECTED");
  const actualDigest = hashStagedChange(value);
  if (actualDigest !== expectedDigest) throw new OutboundPolicyError("Staged change digest mismatch.", "DIGEST_MISMATCH");
  if (approved !== true) throw new OutboundPolicyError("Change awaits explicit developer approval.", "APPROVAL_REQUIRED");
  return Object.freeze({ app, digest: actualDigest, value });
}

export const APEX_CANONICAL_APPS = Object.freeze([
  "PlanetApeX", "KoBlocks", "KernelVision", "KoinKob", "KashKorner", "Kernelodies"
]);


/**
 * Enforce an exact HTTPS hostname allowlist on outbound HTTP calls.
 * Redirects are rejected by createGuardedFetch so a trusted host cannot bounce
 * credentials or prompts to an untrusted destination.
 */
export function validateOutboundTarget(url, allowedHosts) {
  let target;
  try { target = new URL(url instanceof URL ? url.toString() : url instanceof Request ? url.url : String(url)); }
  catch { throw new OutboundPolicyError("Invalid outbound URL.", "INVALID_OUTBOUND_URL"); }
  if (target.protocol !== "https:" || target.username || target.password ||
      !Array.isArray(allowedHosts) || !allowedHosts.includes(target.hostname)) {
    throw new OutboundPolicyError("Outbound target is not on the HTTPS host allowlist.", "TARGET_NOT_ALLOWED");
  }
  return target;
}

export function createGuardedFetch(allowedHosts, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation required");
  const hosts = [...new Set(allowedHosts || [])];
  if (!hosts.length) throw new TypeError("at least one allowed outbound host is required");
  return (input, init = {}) => {
    validateOutboundTarget(input, hosts);
    return fetchImpl(input, { ...init, redirect: "error" });
  };
}
