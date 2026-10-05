import { APEX_LIMITS } from "./mesh/apex-limits.mjs";

const n=(v,d)=>{const x=Number(v);return Number.isFinite(x)&&x>0?x:d};
const bounded=(v,d,max)=>Math.max(1,Math.min(max,n(v,d)));

export const CAPACITY=Object.freeze({
  jsonBody:process.env.APEX_JSON_BODY_LIMIT||"10mb",
  urlencodedBody:process.env.APEX_URLENCODED_BODY_LIMIT||"10mb",
  maxPageSize:n(process.env.APEX_MAX_PAGE_SIZE,1000000),
  jobConcurrency:bounded(process.env.APEX_JOB_CONCURRENCY,APEX_LIMITS.WORKER.CONCURRENCY,APEX_LIMITS.WORKER.MAX_CONCURRENCY),
  providerTimeoutMs:n(process.env.APEX_PROVIDER_TIMEOUT_MS,120000),
  renderTimeoutMs:n(process.env.APEX_RENDER_TIMEOUT_MS,86400000),
  storageBackend:process.env.APEX_STORAGE_BACKEND||"object-store",
  objectStore:process.env.APEX_OBJECT_STORE_URL||"",
  databaseUrl:process.env.DATABASE_URL||"",
  scaleMode:process.env.APEX_SCALE_MODE||"multi-node",
  artificialQuota:false,
  pricingModel:"free-forever",
  subscriptionRequired:false,
  oneTimePurchaseRequired:false
});

export function capacitySnapshot(){
  return {
    ...CAPACITY,
    scalable:Boolean(CAPACITY.databaseUrl),
    externalDatabaseConfigured:Boolean(CAPACITY.databaseUrl),
    objectStoreConfigured:Boolean(CAPACITY.objectStore),
    workerBudget:{
      concurrency:APEX_LIMITS.WORKER.CONCURRENCY,
      maxConcurrency:APEX_LIMITS.WORKER.MAX_CONCURRENCY,
      batchSize:APEX_LIMITS.WORKER.BATCH_SIZE,
      maxBatchSize:APEX_LIMITS.WORKER.MAX_BATCH_SIZE,
      dbPoolDefault:APEX_LIMITS.WORKER.DB_POOL_DEFAULT,
      dbPoolMax:APEX_LIMITS.WORKER.DB_POOL_MAX
    },
    notes:[
      "PostgreSQL is the sole durable queue and application database.",
      "Worker concurrency is bounded independently from database connection count; PostgreSQL pooling multiplexes task I/O.",
      "Resource ceilings are deployment/runtime constraints, not product entitlements.",
      "Third-party providers retain their own contractual, licensing, rate, and billing limits."
    ]
  };
}
