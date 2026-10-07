import { randomUUID } from "node:crypto";
import { apexPureStore } from "../apex-pure-store.mjs";

export function durableWorkerEnabled(){ return true; }
const owner=()=>process.env.RAILWAY_REPLICA_ID||process.env.HOSTNAME||"local";

function unwrap(job){
  if(!job)return null;
  const meta=job.payload?._apex_worker||{};
  return {...job,worker_id:job.leaseOwner||meta.workerId||null,role:meta.role||"general",task:job.type,payload:job.payload?.data??job.payload,lease_token:job.leaseToken,lease_fence:Number(job.leaseFence||0),next_run_at:job.runAt,quarantine_reason:job.lastError&&job.status==="dead"?job.lastError:null,recovered_count:Number(job.recoveredCount||0)};
}
export async function ensureWorkerTaskSchema(){await apexPureStore.init();return true;}
export async function enqueueWorkerTask({id=randomUUID(),workerId="apex-worker",role="general",task,payload={},maxAttempts=5,dedupeKey=null,traceId=null,priority=0,parentJobId=null}){
 if(!task)throw new Error("durable worker task requires task");
 const envelope={_apex_worker:{workerId:String(workerId),role:String(role),traceId:traceId?String(traceId).slice(0,255):null},data:payload&&typeof payload==="object"?payload:{}};
 const result=await apexPureStore.enqueue({id:String(id),type:String(task),payload:envelope,maxAttempts,dedupeKey});
 const job=apexPureStore.jobs().find(j=>j.id===String(result.id));if(job){job.priority=Number(priority)||0;job.parentJobId=parentJobId;}
 return result;
}
export async function claimNextWorkerTasks(limit=20,leaseMs=45000,role=null){return (await apexPureStore.claim({workerId:owner(),limit,leaseMs,role})).map(unwrap);}
export async function claimNextWorkerTask(leaseMs=45000){return (await claimNextWorkerTasks(1,leaseMs))[0]||null;}
export async function claimWorkerTask(id,leaseMs=45000){const jobs=await claimNextWorkerTasks(100,leaseMs);return jobs.find(j=>j.id===String(id))||null;}
export async function heartbeatWorkerTask(id,leaseMs=45000,leaseToken,leaseFence=null){return apexPureStore.transition(id,"heartbeat",{leaseMs,leaseToken,leaseFence});}
export async function completeWorkerTask(id,result=null,leaseToken,leaseFence=null){return apexPureStore.transition(id,"complete",{result,leaseToken,leaseFence});}
export async function failWorkerTask(id,error,leaseToken,leaseFence=null){return apexPureStore.transition(id,"fail",{error,leaseToken,leaseFence});}
export async function deferWorkerTask(id,delayMs=1000,reason="Dependency not ready",leaseToken,leaseFence=null){return apexPureStore.transition(id,"defer",{delayMs,reason,leaseToken,leaseFence});}
export async function quarantineWorkerTask(id,reason,leaseToken,leaseFence=null){return failWorkerTask(id,reason||"QUARANTINED",leaseToken,leaseFence);}
export async function releaseWorkerTasks(ids=[],tokens=[]){let n=0;for(let i=0;i<ids.length;i++)if(await deferWorkerTask(ids[i],1,"released",tokens[i]))n++;return n;}
export async function requeueExpiredWorkerTasks(limit=500){return apexPureStore.recoverExpired(limit);}
export async function getWorkerTask(id){return unwrap(apexPureStore.jobs().find(j=>j.id===String(id)));}
export async function queueStats(){const j=apexPureStore.jobs();return {durable:true,queued:j.filter(x=>x.status==="queued").length,running:j.filter(x=>x.status==="running").length,completed:j.filter(x=>x.status==="completed").length,dead:j.filter(x=>x.status==="dead").length,total:j.length};}
export async function closeWorkerStore(){}
export async function recordWorkerJobEvent(jobId,eventType,payload={},workerId=null){await apexPureStore.enqueue({type:"job.event",payload:{jobId,eventType,payload,workerId}});return true;}
const buckets=new Map();
export async function acquireAiRateLimit({key="default",capacity=10,refillPerSecond=10/60,retryMs=300,maxWaitMs=30000}={}){const deadline=Date.now()+maxWaitMs;while(Date.now()<deadline){const now=Date.now(),b=buckets.get(key)||{tokens:capacity,last:now};b.tokens=Math.min(capacity,b.tokens+((now-b.last)/1000)*refillPerSecond);b.last=now;if(b.tokens>=1){b.tokens--;buckets.set(key,b);return true;}await new Promise(r=>setTimeout(r,retryMs+Math.random()*retryMs));}return false;}
const effects=new Map();
export async function claimExternalEffect(key){key=String(key||"").trim();if(!key)throw new Error("External side effects require an idempotency key");if(effects.has(key))return false;effects.set(key,{status:"started"});return true;}
export async function completeExternalEffect(key,result=null){const e=effects.get(String(key));if(!e)return false;e.status="completed";e.result=result;return true;}
const nodes=new Map();
export async function registerRenderNode({id,capabilities={},maxConcurrency=1,state="ready"}){const k=String(id||owner());nodes.set(k,{id:k,capabilities,maxConcurrency:Math.max(1,Number(maxConcurrency)||1),inFlight:0,state,heartbeatAt:new Date().toISOString()});return true;}
export async function heartbeatRenderNode({id,inFlight=0,state="ready"}){const n=nodes.get(String(id||owner()));if(!n)return false;Object.assign(n,{inFlight:Math.max(0,Number(inFlight)||0),state,heartbeatAt:new Date().toISOString()});return true;}
export async function renderCapacitySnapshot(){const list=[...nodes.values()].map(n=>({...n,available:Math.max(0,n.maxConcurrency-n.inFlight)}));return {durable:true,nodes:list,available:list.reduce((s,n)=>s+n.available,0)};}
