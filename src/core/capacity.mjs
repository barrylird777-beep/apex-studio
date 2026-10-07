const n=(v,d)=>{const x=Number(v);return Number.isFinite(x)&&x>0?x:d};
export const CAPACITY=Object.freeze({
 jsonBody:process.env.APEX_JSON_BODY_LIMIT||"10gb",
 urlencodedBody:process.env.APEX_URLENCODED_BODY_LIMIT||"10gb",
 maxPageSize:n(process.env.APEX_MAX_PAGE_SIZE,1000000),
 jobConcurrency:n(process.env.APEX_JOB_CONCURRENCY,64),
 providerTimeoutMs:n(process.env.APEX_PROVIDER_TIMEOUT_MS,120000),
 renderTimeoutMs:n(process.env.APEX_RENDER_TIMEOUT_MS,86400000),
 storageBackend:"ring-wal",
 dataRoot:process.env.APEX_SE_X_ROOT||"/srv/apex/se-x",
 objectStore:process.env.APEX_OBJECT_STORE_URL||"",
 scaleMode:process.env.APEX_SCALE_MODE||"multi-node",
 artificialQuota:false,
 subscriptionRequired:false,
 oneTimePurchaseRequired:false
});
export function capacitySnapshot(){return {...CAPACITY,scalable:true,externalDatabaseConfigured:false,notes:["Apex execution state uses decentralized JSONL Ring-WAL and atomic filesystem commits.","Runtime limits protect device/process stability; they are not product entitlement quotas.","External AI, payment, distribution, and hosting providers retain their own published limits and terms."]};}