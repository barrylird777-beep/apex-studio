const n=(v,d)=>{const x=Number(v);return Number.isFinite(x)&&x>0?x:d};

export const CAPACITY=Object.freeze({
  jsonBody:process.env.APEX_JSON_BODY_LIMIT||"250mb",
  urlencodedBody:process.env.APEX_URLENCODED_BODY_LIMIT||"250mb",
  maxPageSize:n(process.env.APEX_MAX_PAGE_SIZE,100000),
  jobConcurrency:n(process.env.APEX_JOB_CONCURRENCY,4),
  providerTimeoutMs:n(process.env.APEX_PROVIDER_TIMEOUT_MS,30000),
  renderTimeoutMs:n(process.env.APEX_RENDER_TIMEOUT_MS,3600000),
  storageBackend:process.env.APEX_STORAGE_BACKEND||"filesystem",
  omniBackend:process.env.APEX_OMNI_BACKEND||"sqlite",
  omniDatabase:process.env.APEX_OMNI_DB_FILE||"./apex-omni.sqlite",
  objectStore:process.env.APEX_OBJECT_STORE_URL||"",
  databaseUrl:process.env.DATABASE_URL||"",
  scaleMode:process.env.APEX_SCALE_MODE||"single-node",
});

export function capacitySnapshot(){
  return {
    ...CAPACITY,
    scalable:CAPACITY.omniBackend!=="sqlite"||Boolean(CAPACITY.databaseUrl),
    externalDatabaseConfigured:Boolean(CAPACITY.databaseUrl),
    objectStoreConfigured:Boolean(CAPACITY.objectStore),
    notes:[
      "SQLite remains a local compatibility backend, not the platform ceiling.",
      "Production data-plane settings are environment-driven.",
      "Move hot/shared state to an external database and object store before multi-node scale."
    ]
  };
}
