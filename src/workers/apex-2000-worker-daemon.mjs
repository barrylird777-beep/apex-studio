import os from "node:os";
import pg from "pg";
import { APEX_WORKERS, APEX_WORKER_COUNT, assertWorkerFabric } from "./apex-2000-worker-fabric.mjs";

const { Pool } = pg;
assertWorkerFabric();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const leaseMs=Math.max(15000,Number(process.env.APEX_WORKER_LEASE_MS||30000));
const pollMs=Math.max(100,Number(process.env.APEX_WORKER_FABRIC_POLL_MS||250));
const maxInFlight=Math.max(1,Number(process.env.APEX_WORKER_FABRIC_IN_FLIGHT||APEX_WORKER_COUNT));
const pool=new Pool({
  connectionString:process.env.DATABASE_URL,
  max:Math.max(5,Number(process.env.APEX_PG_POOL_SIZE||20)),
  connectionTimeoutMillis:10000,
  idleTimeoutMillis:30000,
  ssl:process.env.APEX_PG_SSL==="false"?false:{rejectUnauthorized:false}
});
const handlersModule=process.env.APEX_JOB_HANDLER_MODULE?await import(process.env.APEX_JOB_HANDLER_MODULE):null;
const handlerFor=(type)=>{
  const h=handlersModule?.handlers?.[type]??handlersModule?.default?.[type]??handlersModule?.handleJob??handlersModule?.default;
  if(typeof h!=="function") throw new Error("No production handler registered for durable job type: "+type);
  return h;
};
const workersByTask=new Map();
const workersByRole=new Map();
for(const worker of APEX_WORKERS){
  const taskList=workersByTask.get(worker.task)??[];
  taskList.push(worker);
  workersByTask.set(worker.task,taskList);
  const roleList=workersByRole.get(worker.role)??[];
  roleList.push(worker);
  workersByRole.set(worker.role,roleList);
}

function workersForJob(job){
  const requested=String(job?.payload?.workerTask||job?.workerTask||"");
  if(requested && workersByTask.has(requested)) return workersByTask.get(requested);
  const exact=workersByTask.get(String(job?.type||""));
  if(exact) return exact;
  const role=String(job?.payload?.workerRole||"").toLowerCase();
  if(role && workersByRole.has(role)) return workersByRole.get(role);
  const prefix=String(job?.type||"").split(/[._-]/)[0].toLowerCase();
  if(workersByRole.has(prefix)) return workersByRole.get(prefix);
  return APEX_WORKERS;
}
const active=new Set();
let stopping=false;

async function claimWave(){
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const types=[...workersByTask.keys(), ...(handlersModule?.handlers ? Object.keys(handlersModule.handlers) : [])].filter((v,i,a)=>a.indexOf(v)===i);
    const room=Math.max(0,Math.min(APEX_WORKER_COUNT,maxInFlight-active.size));
    if(!room){await client.query("ROLLBACK");return [];}
    const result=await client.query(
      `WITH next AS (
        SELECT id
        FROM durable_jobs
        WHERE status='queued' AND run_at<=NOW() AND type=ANY($1::text[])
        ORDER BY priority DESC,run_at,created_at
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      UPDATE durable_jobs j
      SET status='running',
          lease_owner=$3,
          lease_token=md5(random()::text||clock_timestamp()::text||j.id::text)::uuid,
          lease_fence=j.lease_fence+1,
          lease_expires_at=NOW()+($4::double precision*INTERVAL '1 millisecond'),
          attempts=j.attempts+1,
          updated_at=NOW()
      FROM next
      WHERE j.id=next.id
      RETURNING j.*`,
      [types,room,process.env.APEX_WORKER_ID||`fabric-${os.hostname()}-${process.pid}`,leaseMs]
    );
    await client.query("COMMIT");
    return result.rows;
  }catch(error){await client.query("ROLLBACK");throw error}finally{client.release();}
}

async function heartbeat(job){
  const result=await pool.query(
    `UPDATE durable_jobs SET lease_expires_at=NOW()+($4::double precision*INTERVAL '1 millisecond'),updated_at=NOW()
     WHERE id=$1 AND status='running' AND lease_token=$2::uuid AND lease_fence=$3 AND lease_expires_at>NOW()
     RETURNING id`,[job.id,job.lease_token,job.lease_fence,leaseMs]);
  return result.rowCount===1;
}

async function finish(job,result){
  return (await pool.query(
    `UPDATE durable_jobs SET status='completed',result=$4::jsonb,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=NOW()
     WHERE id=$1 AND status='running' AND lease_token=$2::uuid AND lease_fence=$3 AND lease_expires_at>NOW()`,
    [job.id,job.lease_token,job.lease_fence,JSON.stringify(result??null)])).rowCount===1;
}

async function fail(job,error){
  const retry=Number(job.attempts)<Number(job.max_attempts);
  const retryAt=retry?new Date(Date.now()+Math.min(60000,1000*2**Math.max(0,Number(job.attempts)-1))):null;
  return (await pool.query(
    `UPDATE durable_jobs SET status=CASE WHEN $5::boolean THEN 'queued' ELSE 'dead' END,
       run_at=CASE WHEN $5::boolean THEN $6::timestamptz ELSE run_at END,last_error=$4,
       lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=NOW()
     WHERE id=$1 AND status='running' AND lease_token=$2::uuid AND lease_fence=$3`,
    [job.id,job.lease_token,job.lease_fence,error,retry,retryAt])).rowCount===1;
}

async function run(job){
  const workers=workersForJob(job);
  const worker=workers[Number(job.attempts)%Math.max(1,workers.length)];
  const hb=setInterval(()=>void heartbeat(job).catch(()=>{}),Math.max(5000,Math.floor(leaseMs/3)));
  hb.unref?.();
  try{
    const result=await handlerFor(job.type)({...job,workerId:worker?.id??"unassigned",workerTask:worker?.task??job.type});
    if(!await finish(job,result)) throw new Error("stale worker completion rejected");
  }catch(error){await fail(job,error instanceof Error?error.message:String(error));}
  finally{clearInterval(hb);}
}

async function main(){
  await pool.query("SELECT 1");
  console.log("[APEX 2000 FABRIC] online",APEX_WORKER_COUNT,"fixed workers");
  while(!stopping){
    if(active.size<maxInFlight){
      const jobs=await claimWave();
      for(const job of jobs){
        const p=run(job);
        active.add(p);
        p.finally(()=>active.delete(p)).catch(()=>{});
      }
    }
    await new Promise(r=>setTimeout(r,pollMs));
  }
}

async function shutdown(signal){
  if(stopping)return;
  stopping=true;
  console.log("[APEX 2000 FABRIC] draining",signal);
  await Promise.allSettled([...active]);
  await pool.end();
}
process.once("SIGTERM",()=>void shutdown("SIGTERM"));
process.once("SIGINT",()=>void shutdown("SIGINT"));
main().catch(async e=>{console.error("[APEX 2000 FABRIC] fatal",e);await pool.end().catch(()=>{});process.exitCode=1;});
