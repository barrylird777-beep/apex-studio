const n=(v,d)=>{const x=Number(v);return Number.isFinite(x)&&x>0?x:d};

export const CAPACITY=Object.freeze({
  // Resource limits are safety controls, not product quotas.
  jsonBody:process.env.APEX_JSON_BODY_LIMIT||"10gb",
  urlencodedBody:process.env.APEX_URLENCODED_BODY_LIMIT||"10gb",
  maxPageSize:n(process.env.APEX_MAX_PAGE_SIZE,1000000),
  jobConcurrency:n(process.env.APEX_JOB_CONCURRENCY,64),
  providerTimeoutMs:n(process.env.APEX_PROVIDER_TIMEOUT_MS,120000),
  renderTimeoutMs:n(process.env.APEX_RENDER_TIMEOUT_MS,86400000),
  // Canonical persistence is local Pure-WAL/Ring-WAL; no SQL backend is selected.
  storageBackend:"pure-wal",
  omniBackend:"pure-wal",
  omniDatabase:null,
  objectStore:process.env.APEX_OBJECT_STORE_URL||"",
  databaseUrl:"",
  scaleMode:"sovereign-pure-wal",
  artificialQuota:false,
  pricingModel:"free-forever",
  subscriptionRequired:false,
  oneTimePurchaseRequired:false
});

export function capacitySnapshot(){
  const distributedStorageConfigured=Boolean(
    String(process.env.APEX_ALLOWED_PEER_IDS||"").trim() &&
    String(process.env.APEX_BOOTSTRAP_PEERS||"").trim() &&
    String(process.env.APEX_SOVEREIGN_PEER_ADDRESS||process.env.APEX_EDGE_PEER_ADDRESS||"").trim()
  );
  return {
    ...CAPACITY,
    scalable:true,
    externalDatabaseConfigured:false,
    distributedStorageConfigured,
    objectStoreConfigured:Boolean(CAPACITY.objectStore),
    notes:[
      "Apex durable application state uses Pure-WAL/Ring-WAL; SQL and SQLite are not selected backends.",
      "Local durability does not by itself prove cross-device replication or public peer connectivity.",
      "External mesh readiness requires a verified peer identity, allowlist, bootstrap peers, and public peer address.",
      "Resource ceilings are deployment/runtime constraints, not product entitlements.",
      "Third-party providers retain their own contractual, licensing, rate, and billing limits."
    ]
  };
}
