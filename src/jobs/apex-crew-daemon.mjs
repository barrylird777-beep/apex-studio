import { apexPureStore } from "../core/apex-pure-store.mjs";
import { APEX_CREW, registerCrewMember, heartbeatCrewMember } from "../core/apex-crew.mjs";

const workerId=process.env.APEX_WORKER_ID||"crew-"+process.pid;
const role=process.env.APEX_CREW_ROLE||"overseer";
const leaseMs=Math.max(5000,Number(process.env.APEX_CREW_LEASE_MS||45000));
const batchSize=Math.max(1,Math.min(32,Number(process.env.APEX_CREW_BATCH||8)));
const intervalMs=Math.max(250,Number(process.env.APEX_CREW_INTERVAL_MS||500));
let stopping=false;

async function main(){
  if(!APEX_CREW[role])throw new Error("Unknown crew role: "+role);
  await apexPureStore.init();
  await registerCrewMember({role,id:workerId,capabilities:[role,"pure-wal","six-surface"]});

  const stop=()=>{stopping=true};
  process.once("SIGTERM",stop); process.once("SIGINT",stop);

  while(!stopping){
    await heartbeatCrewMember(workerId,{status:"online",leaseMs});
    if(role==="overseer"){
      await apexPureStore.recoverExpired(500);
      await new Promise(r=>setTimeout(r,intervalMs));
      continue;
    }
    const jobs=await apexPureStore.claim({workerId,role,limit:batchSize,leaseMs});
    for(const job of jobs){
      try{
        // The crew daemon claims and fences work. Domain workers consume these
        // envelopes; this daemon never invents successful results.
        await apexPureStore.heartbeat(job.id,job.leaseToken,leaseMs,job.leaseFence);
      }catch(error){
        await apexPureStore.transition(job.id,"fail",{leaseToken:job.leaseToken,leaseFence:job.leaseFence,error});
      }
    }
    await new Promise(r=>setTimeout(r,intervalMs));
  }

  await heartbeatCrewMember(workerId,{status:"offline"});
}
main().catch(error=>{console.error("[APEX CREW]",error);process.exitCode=1});
