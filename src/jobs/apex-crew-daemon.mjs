import { apexPureStore } from "../core/apex-pure-store.mjs";
import { APEX_CREW, registerCrewMember, heartbeatCrewMember } from "../core/apex-crew.mjs";

const workerId=process.env.APEX_WORKER_ID||"crew-"+process.pid;
const role=process.env.APEX_CREW_ROLE||"overseer";
const leaseMs=Math.max(5000,Number(process.env.APEX_CREW_LEASE_MS||45000));
const batchSize=Math.max(1,Math.min(32,Number(process.env.APEX_CREW_BATCH||8)));
const intervalMs=Math.max(250,Number(process.env.APEX_CREW_INTERVAL_MS||500));
let stopping=false;
async function executeCrewJob(job){
  const data=job.payload?.data||{};
  switch(role){
    case "music":
    case "model": {
      const { createMusicBrief }=await import("../core/kornkob-music-intelligence.mjs");
      return createMusicBrief({task:job.type,context:data,needs:data.needs||[]});
    }
    case "researcher": {
      const { searchAnything }=await import("../core/apex-web-search.mjs");
      if(!data.query) return {accepted:true,reason:"research task requires query; envelope retained"};
      return searchAnything(data.query,{limit:Number(data.limit||20)});
    }
    case "adblock": {
      const { checkAdBlockUpstream,studioAdBlockStatus }=await import("../network/studio-adblock-doh.mjs");
      const upstream=await checkAdBlockUpstream();
      return {status:studioAdBlockStatus(),upstream};
    }
    case "network": {
      const { searchAnything }=await import("../core/apex-web-search.mjs");
      if(data.query)return searchAnything(data.query,{limit:Number(data.limit||20)});
      return {networkTask:true,accepted:true};
    }
    case "inspector":
    case "security":
    case "code":
    case "director":
    case "mastering":
    case "analytics":
    case "growth":
    case "commerce":
    case "opportunity":
    case "scripture":
    case "video":
    case "visual":
    case "voice":
      return {accepted:true,role,task:job.type,dispatchOnly:true,payload:data};
    default: throw new Error("No executor registered for crew role: "+role);
  }
}


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
        const result=await executeCrewJob(job);
        await apexPureStore.transition(job.id,"complete",{leaseToken:job.leaseToken,leaseFence:job.leaseFence,result});
      }catch(error){
        await apexPureStore.transition(job.id,"fail",{leaseToken:job.leaseToken,leaseFence:job.leaseFence,error});
      }
    }
    await new Promise(r=>setTimeout(r,intervalMs));
  }

  await heartbeatCrewMember(workerId,{status:"offline"});
}
main().catch(error=>{console.error("[APEX CREW]",error);process.exitCode=1});
