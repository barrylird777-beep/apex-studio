import { randomUUID } from "node:crypto";
import { apexPureStore } from "../apex-pure-store.mjs";

const clone = value => value == null ? value : structuredClone(value);
const ownerId = () => process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local";

export function durableWorkerEnabled() {
  return String(process.env.APEX_DISABLE_DURABLE_WORKERS || "").toLowerCase() !== "true";
}

export async function durableWorkerHealth() {
  try {
    if (!durableWorkerEnabled()) return { configured:false, available:false, status:"disabled", checkedAt:new Date().toISOString(), lastError:null };
    await apexPureStore.init();
    return { configured:true, available:true, status:"ready", storage:"local-pure-wal", checkedAt:new Date().toISOString(), lastError:null };
  } catch (error) {
    return { configured:true, available:false, status:"unavailable", storage:"local-pure-wal", checkedAt:new Date().toISOString(), lastError:String(error?.message || error).slice(0,500) };
  }
}

export function getPool() {
  throw new Error("PostgreSQL worker pools are retired; durable tasks use the Pure-WAL store.");
}

function unwrap(job) {
  if (!job) return null;
  const meta = job.payload && typeof job.payload === "object" ? job.payload._apex_worker || {} : {};
  const payload = job.payload && typeof job.payload === "object" ? job.payload.data ?? job.payload : {};
  return {
    ...job,
    worker_id: job.leaseOwner || meta.workerId || null,
    role: meta.role || "general",
    task: job.type,
    payload: clone(payload),
    lease_token: job.leaseToken,
    lease_fence: Number(job.leaseFence || 0),
    next_run_at: job.runAt,
    max_attempts: job.maxAttempts,
    last_error: job.lastError,
    quarantine_reason: job.lastError && job.status === "dead" ? job.lastError : null,
    recovered_count: Number(job.recoveredCount || 0),
    created_at: job.createdAt,
    updated_at: job.updatedAt
  };
}

export async function ensureWorkerTaskSchema() {
  if (!durableWorkerEnabled()) return false;
  await apexPureStore.init();
  return true;
}

export async function enqueueWorkerTask({
  id = randomUUID(), workerId, role, task, payload = {}, maxAttempts = 5,
  dedupeKey = null, traceId = null, priority = 0, parentJobId = null
} = {}) {
  if (!durableWorkerEnabled()) return { durable:false, id };
  if (!task) throw new Error("durable worker task requires task");
  const result = await apexPureStore.enqueue({
    id:String(id),
    type:String(task),
    payload:{
      _apex_worker:{workerId:String(workerId || "apex-worker"),role:String(role || "general"),traceId:traceId ? String(traceId).slice(0,255) : null,parentJobId:parentJobId == null ? null : String(parentJobId)},
      data:payload && typeof payload === "object" ? clone(payload) : {},
      priority:Number(priority) || 0
    },
    maxAttempts:Math.max(1,Number(maxAttempts) || 5),
    priority:Number(priority)||0,
    dedupeKey:dedupeKey == null ? null : String(dedupeKey)
  });
  return { durable:true, id:String(result.id), duplicate:Boolean(result.duplicate), status:result.status || "queued", storage:"local-pure-wal" };
}

export async function claimNextWorkerTasks(limit = 20, leaseMs = 45000, role = null) {
  if (!durableWorkerEnabled()) return [];
  const claimed = await apexPureStore.claim({workerId:ownerId(),limit,leaseMs,role});
  return claimed.map(unwrap);
}

export async function claimNextWorkerTask(leaseMs = 45000) {
  return (await claimNextWorkerTasks(1,leaseMs))[0] || null;
}

export async function claimWorkerTask(id, leaseMs = 45000) {
  if (!durableWorkerEnabled()) return null;
  const claimed = await apexPureStore.claim({workerId:ownerId(),limit:1,leaseMs,onlyId:String(id)});
  return unwrap(claimed[0]);
}

export async function heartbeatWorkerTask(id, leaseMs = 45000, leaseToken, leaseFence = null) {
  if (!durableWorkerEnabled()) return false;
  return apexPureStore.transition(String(id),"heartbeat",{leaseToken,leaseFence,leaseMs});
}

export async function completeWorkerTask(id, result = null, leaseToken, leaseFence = null) {
  if (!durableWorkerEnabled()) return false;
  return apexPureStore.transition(String(id),"complete",{leaseToken,leaseFence,result});
}

export async function failWorkerTask(id, error, leaseToken, leaseFence = null) {
  if (!durableWorkerEnabled()) return false;
  return apexPureStore.transition(String(id),"fail",{leaseToken,leaseFence,error});
}

export async function deferWorkerTask(id, delayMs = 1000, reason = "Dependency not ready", leaseToken, leaseFence = null) {
  if (!durableWorkerEnabled()) return false;
  return apexPureStore.transition(String(id),"defer",{leaseToken,leaseFence,delayMs,reason});
}

export async function quarantineWorkerTask(id, reason, leaseToken, leaseFence = null) {
  return failWorkerTask(id,reason || "QUARANTINED",leaseToken,leaseFence);
}

export async function releaseWorkerTasks(taskIds = [], leaseTokens = []) {
  if (!durableWorkerEnabled() || !taskIds.length) return 0;
  if (leaseTokens.length !== taskIds.length) throw new Error("releaseWorkerTasks requires one lease token per task");
  let released = 0;
  for (let index=0; index<taskIds.length; index++) {
    const job = apexPureStore.jobs().find(item => item.id === String(taskIds[index]));
    if (job && await apexPureStore.transition(job.id,"defer",{leaseToken:leaseTokens[index],leaseFence:job.leaseFence,delayMs:100,reason:"Worker released task"})) released++;
  }
  return released;
}

export async function requeueExpiredWorkerTasks(limit = 500) {
  if (!durableWorkerEnabled()) return 0;
  return apexPureStore.recoverExpired(Math.max(1,Math.min(5000,Number(limit)||500)));
}

export async function acquireAiRateLimit({ key = "gemini", capacity = 10, refillPerSecond = 10/60, retryMs = 300, maxWaitMs = 30000 } = {}) {
  if (!durableWorkerEnabled()) return true;
  const cap=Math.max(1,Number(capacity)||10), refill=Math.max(0.0001,Number(refillPerSecond)||10/60);
  const wait=Math.max(50,Number(retryMs)||300), deadline=Date.now()+Math.max(0,Number(maxWaitMs)||0);
  const collection="apex_ai_rate_limits", id=String(key).slice(0,128);
  for (;;) {
    const acquired=await apexPureStore.withMutationLock(async()=>{
      await apexPureStore.refresh();
      const now=Date.now(), current=await apexPureStore.get(collection,id);
      const tokens=Math.min(cap,Number(current?.tokens ?? cap)+Math.max(0,now-Number(current?.updatedAtMs||now))/1000*refill);
      if(tokens<1) { await apexPureStore.put(collection,id,{tokens,updatedAtMs:now}); return false; }
      await apexPureStore.put(collection,id,{tokens:tokens-1,updatedAtMs:now}); return true;
    });
    if(acquired) return true;
    if(Date.now()>=deadline) return false;
    await new Promise(resolve=>setTimeout(resolve,wait+Math.random()*wait));
  }
}

export async function claimExternalEffect(idempotencyKey) {
  if (!durableWorkerEnabled()) return true;
  const key=String(idempotencyKey||"").trim();
  if(!key) throw new Error("External side effects require an idempotency key");
  return apexPureStore.withMutationLock(async()=>{
    await apexPureStore.refresh();
    if(await apexPureStore.get("apex_external_effects",key)) return false;
    await apexPureStore.put("apex_external_effects",key,{status:"started",createdAt:new Date().toISOString()});
    return true;
  });
}

export async function completeExternalEffect(idempotencyKey,result=null) {
  if(!durableWorkerEnabled()) return true;
  const key=String(idempotencyKey||"").trim();
  if(!key) throw new Error("External side effects require an idempotency key");
  return apexPureStore.withMutationLock(async()=>{
    await apexPureStore.refresh();
    const existing=await apexPureStore.get("apex_external_effects",key);
    if(!existing||existing.status!=="started") return false;
    await apexPureStore.put("apex_external_effects",key,{...existing,status:"completed",result:clone(result),updatedAt:new Date().toISOString()});
    return true;
  });
}

export async function getWorkerTask(id) {
  if (!durableWorkerEnabled()) return null;
  await apexPureStore.refresh();
  return unwrap(apexPureStore.jobs().find(job=>job.id===String(id)));
}

export async function queueStats() {
  if (!durableWorkerEnabled()) return {durable:false};
  await apexPureStore.refresh();
  const jobs=apexPureStore.jobs();
  return {durable:true,storage:"local-pure-wal",queued:jobs.filter(j=>j.status==="queued").length,running:jobs.filter(j=>j.status==="running").length,completed:jobs.filter(j=>j.status==="completed").length,dead:jobs.filter(j=>j.status==="dead").length,total:jobs.length};
}

export async function closeWorkerStore() { await apexPureStore.refresh(); }

export async function recordWorkerJobEvent(jobId,eventType,payload={},workerId=null) {
  if(!durableWorkerEnabled()) return false;
  const id=randomUUID();
  await apexPureStore.put("apex_job_events",id,{jobId:String(jobId),eventType:String(eventType||"unknown").slice(0,120),workerId:workerId?String(workerId).slice(0,255):null,payload:clone(payload),createdAt:new Date().toISOString()});
  return true;
}

export async function registerRenderNode({id,capabilities={},maxConcurrency=1,state="ready"}={}) {
  if(!durableWorkerEnabled()) return false;
  const nodeId=String(id||ownerId()).slice(0,255);
  const existing=await apexPureStore.get("render_nodes",nodeId);
  await apexPureStore.put("render_nodes",nodeId,{...(existing||{}),id:nodeId,capabilities:clone(capabilities),maxConcurrency:Math.max(1,Number(maxConcurrency)||1),inFlight:Number(existing?.inFlight||0),heartbeatAt:new Date().toISOString(),state:String(state||"ready")});
  return true;
}

export async function heartbeatRenderNode({id,inFlight=0,state="ready"}={}) {
  if(!durableWorkerEnabled()) return false;
  const nodeId=String(id||ownerId()).slice(0,255), existing=await apexPureStore.get("render_nodes",nodeId);
  if(!existing) return false;
  await apexPureStore.put("render_nodes",nodeId,{...existing,inFlight:Math.max(0,Number(inFlight)||0),heartbeatAt:new Date().toISOString(),state:String(state||"ready")});
  return true;
}

export async function renderCapacitySnapshot() {
  if(!durableWorkerEnabled()) return {durable:false,nodes:[],available:0};
  const nodes=(await apexPureStore.list("render_nodes")).filter(node=>node.state==="ready").map(node=>({...node,available:Math.max(0,Number(node.maxConcurrency||1)-Number(node.inFlight||0))}));
  return {durable:true,storage:"local-pure-wal",nodes,available:nodes.reduce((sum,node)=>sum+node.available,0)};
}
