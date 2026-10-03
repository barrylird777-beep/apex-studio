const n=(v,d)=>{const x=Number(v);return Number.isFinite(x)&&x>0?x:d};

export const CAPACITY=Object.freeze({
  // Apex imposes no subscription/paywall quotas. These are generous resource-safety
  // defaults and remain fully environment-configurable for larger deployments.
  jsonBody:process.env.APEX_JSON_BODY_LIMIT||"10gb",
  urlencodedBody:process.env.APEX_URLENCODED_BODY_LIMIT||"10gb",
  maxPageSize:n(process.env.APEX_MAX_PAGE_SIZE,1000000),
  jobConcurrency:n(process.env.APEX_JOB_CONCURRENCY,64),
  providerTimeoutMs:n(process.env.APEX_PROVIDER_TIMEOUT_MS,120000),
  renderTimeoutMs:n(process.env.APEX_RENDER_TIMEOUT_MS,86400000),
  storageBackend:process.env.APEX_STORAGE_BACKEND||"filesystem",
  omniBackend:process.env.APEX_OMNI_BACKEND||"sqlite",
  omniDatabase:process.env.APEX_OMNI_DB_FILE||"./apex-omni.sqlite",
  objectStore:process.env.APEX_OBJECT_STORE_URL||"",
  databaseUrl:process.env.DATABASE_URL||"",
  scaleMode:process.env.APEX_SCALE_MODE||"multi-node",
  artificialQuota:false
});

export function capacitySnapshot(){
  return {
    ...CAPACITY,
    scalable:CAPACITY.omniBackend!=="sqlite"||Boolean(CAPACITY.databaseUrl),
    externalDatabaseConfigured:Boolean(CAPACITY.databaseUrl),
    objectStoreConfigured:Boolean(CAPACITY.objectStore),
    notes:[
      "Apex has no subscription, payment, premium-tier, credit, or artificial usage quota.",
      "Resource ceilings are deployment/runtime constraints, not product entitlements.",
      "For multi-node production, use shared PostgreSQL/object storage and scale workers horizontally.",
      "Third-party providers retain their own contractual, licensing, rate, and billing limits."
    ]
  };
}
