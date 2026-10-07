import { randomUUID } from "node:crypto";
import { apexPureDataStore } from "../apex-pure-data.mjs";

const tokenBuckets = new Map();
const renderNodes = new Map();
const externalEffects = new Map();

export function durableWorkerEnabled() { return true; }

function unwrap(job) {
  if (!job) return null;
  const meta = job.payload?._apex_worker || {};
  return { ...job, worker_id: job.leaseOwner, role: meta.role || "general", task: job.type, payload: job.payload?.data ?? job.payload, lease_token: job.leaseToken, lease_fence: Number(job.leaseFence || 0), next_run_at: job.runAt, quarantine_reason: job.lastError && job.status === "dead" ? job.lastError : null, recovered_count: Number(job.recoveredCount || 0) };
}

export async function ensureWorkerTaskSchema() { await apexPureDataStore.init(); return true; }

export async function enqueueWorkerTask({ id=randomUUID(), workerId="apex-worker", role="general", task, payload={}, maxAttempts=5, dedupeKey=null, traceId=null, priority=0, parentJobId=null }) {
  if (!task) throw new Error("durable worker task requires task");
  const envelope={_apex_worker:{workerId:String(workerId),role:String(role),traceId:traceId?String(traceId).slice(0,255):null},data:payload&&typeof payload==="object"?payload:{}};
  const existing=dedupeKey ? (await apexPureDataStore.jobs()).find(j=>j.dedupeKey===String(dedupeKey)&&["queued","running"].includes(j.status)) : null;
  if (existing) return {durable:true,id:existing.id,duplicate:true};
  const job=await apexPureDataStore.enqueue({id:String(id),type:String(task),payload:envelope,maxAttempts,dedupeKey});
  job.payload=envelope; job.priority=Number(priority)||0; job.parentJobId=parentJobId; job.workerId=String(workerId);
  return {durable:true,id:job.id};
}

export async function claimNextWorkerTasks(limit=20,leaseMs=45000,role=null) {
  return (await apexPureDataStore.claim({workerId:process.env.HOSTNAME||"local",limit,leaseMs,role})).map(unwrap);
}
export async function claimNextWorkerTask(leaseMs=45000){return (await claimNextWorkerTasks(1,leaseMs))[0]||null;}
export async function claimWorkerTask(id,leaseMs=45000){return (await apexPureDataStore.claim({workerId:process.env.HOSTNAME||"local",limit:1,leaseMs})).map(unwrap).find(x=>x.id===id)||null;}
export async function heartbeatWorkerTask(id,leaseMs=45000,leaseToken,leaseFence=null){return apexPureDataStore.transition(id,"heartbeat",{leaseMs,leaseToken,leaseFence});}
export async function completeWorkerTask(id,result=null,leaseToken,leaseFence=null){return apexPureDataStore.transition(id,"complete",{result,leaseToken,leaseFence});}
export async function failWorkerTask(id,error,leaseToken,leaseFence=null){return apexPureDataStore.transition(id,"fail",{error:String(error?.message||error),leaseToken,leaseFence});}
export async function deferWorkerTask(id,delayMs=1000,reason="Dependency not ready",leaseToken,leaseFence=null){return apexPureDataStore.transition(id,"defer",{delayMs,reason,leaseToken,leaseFence});}
export async function quarantineWorkerTask(id,reason,leaseToken,leaseFence=null){return failWorkerTask(id,reason||"QUARANTINED",leaseToken,leaseFence);}

export async function releaseWorkerTasks(taskIds=[],leaseTokens=[]) {
  let released=0;
  for(let i=0;i<taskIds.length;i++) if(await apexPureDataStore.transition(taskIds[i],"defer",{delayMs:1,leaseToken:leaseTokens[i]})) released++;
  return released;
}
export async function requeueExpiredWorkerTasks(limit=500){return apexPureDataStore.recoverExpired(limit);}
export async function getWorkerTask(id){return unwrap((await apexPureDataStore.jobs()).find(j=>j.id===String(id)));}
export async function queueStats(){const jobs=await apexPureDataStore.jobs();return {durable:true,queued:jobs.filter(j=>j.status==="queued").length,running:jobs.filter(j=>j.status==="running").length,completed:jobs.filter(j=>j.status==="completed").length,dead:jobs.filter(j=>j.status==="dead").length,total:jobs.length};}
export async function closeWorkerStore(){}
export async function recordWorkerJobEvent(jobId,eventType,payload={},workerId=null){await apexPureDataStore.enqueue({type:"job.event",payload:{jobId,eventType,payload,workerId}});return true;}

export async function acquireAiRateLimit({key="default",capacity=10,refillPerSecond=10/60,retryMs=300,maxWaitMs=30000}={}) {
  const deadline=Date.now()+maxWaitMs;
  while(Date.now()<deadline){
    const b=tokenBuckets.get(key)||{tokens:capacity,last:Date.now()};
    const now=Date.now(); b.tokens=Math.min(capacity,b.tokens+((now-b.last)/1000)*refillPerSecond); b.last=now;
    if(b.tokens>=1){b.tokens-=1;tokenBuckets.set(key,b);return true;}
    await new Promise(r=>setTimeout(r,retryMs+Math.floor(Math.random()*retryMs)));
  }
  return false;
}
export async function claimExternalEffect(idempotencyKey){const key=String(idempotencyKey||"").trim();if(!key)throw new Error("External side effects require an idempotency key");if(externalEffects.has(key))return false;externalEffects.set(key,{status:"started"});return true;}
export async function completeExternalEffect(idempotencyKey,result=null){const key=String(idempotencyKey||"").trim();const e=externalEffects.get(key);if(!e)return false;e.status="completed";e.result=result;return true;}
export async function registerRenderNode({id,capabilities={},maxConcurrency=1,state="ready"}){renderNodes.set(String(id||process.env.HOSTNAME||"local"),{id:String(id||process.env.HOSTNAME||"local"),capabilities,maxConcurrency:Math.max(1,Number(maxConcurrency)||1),inFlight:0,state,heartbeatAt:new Date().toISOString()});return true;}
export async function heartbeatRenderNode({id,inFlight=0,state="ready"}){const n=renderNodes.get(String(id||process.env.HOSTNAME||"local"));if(!n)return false;Object.assign(n,{inFlight:Math.max(0,Number(inFlight)||0),state,heartbeatAt:new Date().toISOString()});return true;}
export async function renderCapacitySnapshot(){const nodes=[...renderNodes.values()].map(n=>({...n,available:Math.max(0,n.maxConcurrency-n.inFlight)}));return {durable:true,nodes,available:nodes.reduce((s,n)=>s+n.available,0)};}
