function numberInRange(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function boundedByteLimit(value, fallback, maxBytes) {
  if (value == null || String(value).trim() === "") return fallback;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?\s*$/i.exec(String(value));
  if (!match) return fallback;
  const units = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };
  const bytes = Number(match[1]) * (units[(match[2] || "b").toLowerCase()] || 1);
  if (!Number.isFinite(bytes) || bytes <= 0) return fallback;
  const bounded = Math.min(bytes, maxBytes);
  if (bounded >= 1024 ** 2) return Math.floor(bounded / (1024 ** 2)) + "mb";
  if (bounded >= 1024) return Math.floor(bounded / 1024) + "kb";
  return Math.floor(bounded) + "b";
}

export const CAPACITY = Object.freeze({
  // Request-size limits are security boundaries. Large media must use streamed upload paths.
  jsonBody: boundedByteLimit(process.env.APEX_JSON_BODY_LIMIT, "10mb", 50 * 1024 * 1024),
  urlencodedBody: boundedByteLimit(process.env.APEX_URLENCODED_BODY_LIMIT, "1mb", 5 * 1024 * 1024),
  maxPageSize: numberInRange(process.env.APEX_MAX_PAGE_SIZE, 100, 1, 1000),
  jobConcurrency: numberInRange(process.env.APEX_JOB_CONCURRENCY, 64, 1, 256),
  providerTimeoutMs: numberInRange(process.env.APEX_PROVIDER_TIMEOUT_MS, 30000, 1000, 120000),
  renderTimeoutMs: numberInRange(process.env.APEX_RENDER_TIMEOUT_MS, 86400000, 1000, 86400000),
  // Canonical persistence is content-addressed; legacy WAL is read-only migration input.
  storageBackend: "content-addressed",
  omniBackend: "content-addressed",
  omniDatabase: null,
  objectStore: process.env.APEX_OBJECT_STORE_URL || "",
  databaseUrl: "",
  scaleMode: "sovereign-pure-wal",
  artificialQuota: false,
  pricingModel: "free-forever",
  subscriptionRequired: false,
  oneTimePurchaseRequired: false
});

export function capacitySnapshot() {
  const distributedStorageConfigured = Boolean(
    String(process.env.APEX_ALLOWED_PEER_IDS || "").trim() &&
    String(process.env.APEX_BOOTSTRAP_PEERS || "").trim() &&
    String(process.env.APEX_SOVEREIGN_PEER_ADDRESS || process.env.APEX_EDGE_PEER_ADDRESS || "").trim()
  );
  return {
    ...CAPACITY,
    scalable: true,
    externalDatabaseConfigured: false,
    distributedStorageConfigured,
    objectStoreConfigured: Boolean(CAPACITY.objectStore),
    notes: [
      "Apex app state and durable worker tasks use immutable content-addressed objects and atomic manifests; SQL and WAL are not selected for that store.",
      "Local durability does not by itself prove cross-device replication or public peer connectivity.",
      "External mesh readiness requires a verified peer identity, allowlist, bootstrap peers, and public peer address.",
      "Resource ceilings are deployment/runtime constraints, not product entitlements.",
      "Third-party providers retain their own contractual, licensing, rate, and billing limits."
    ]
  };
}
