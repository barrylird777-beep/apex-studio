import { randomUUID } from "node:crypto";
import { apexPureStore } from "./apex-pure-store.mjs";

export const APEX_CREW=Object.freeze({
  overseer:{role:"overseer",mission:"coordinate all six surfaces, detect stalls, recover work",priority:120},
  network:{role:"network",mission:"network stack, public-web search, DNS, transport and protection",priority:118},
  inspector:{role:"inspector",mission:"final verification, adversarial inspection and release gating",priority:116},
  security:{role:"security",mission:"security boundaries, provenance, abuse resistance and policy validation",priority:114},
  code:{role:"code",mission:"implementation, testing, repair and runtime integration",priority:112},
  researcher:{role:"researcher",mission:"public-web research, source discovery and provenance",priority:100},
  scripture:{role:"scripture",mission:"scripture research, cross-reference and source validation",priority:92},
  video:{role:"video",mission:"rapid video production, FFmpeg mastering and QC",priority:96},
  visual:{role:"visual",mission:"visual direction, image/video planning and visual effects",priority:88},
  music:{role:"music",mission:"music, sound design, audio FX and discovery",priority:86},
  voice:{role:"voice",mission:"voiceover, narration and speech production",priority:82},
  opportunity:{role:"opportunity",mission:"business, monetization and opportunity research",priority:78}
});

export const SURFACES=Object.freeze({
  KORNKOB:["music","researcher","network","security"],
  ApexStudios:["video","visual","voice","code","inspector"],
  GardenOfApex:["researcher","scripture","visual","music","inspector"],
  ApexOpportunity:["opportunity","researcher","security","network"],
  ApexRapidVideo:["video","voice","visual","opportunity","code"],
  ApexAdBlocker:["network","security","code","inspector"]
});

export function crewMember(role){return APEX_CREW[String(role)]||null;}
export function surfaceCrew(surface){return (SURFACES[surface]||[]).map(crewMember).filter(Boolean);}

export async function registerCrewMember({role,id=process.env.APEX_WORKER_ID||randomUUID(),capabilities=[]}={}){
  const member=crewMember(role); if(!member)throw new Error("Unknown Apex crew role: "+role);
  return apexPureStore.put("crew_members",String(id),{
    id:String(id),role:member.role,mission:member.mission,priority:member.priority,
    capabilities:[...new Set(capabilities.map(String))],status:"online",
    heartbeatAt:new Date().toISOString()
  });
}

export async function heartbeatCrewMember(id,patch={}){
  const current=await apexPureStore.get("crew_members",id); if(!current)return false;
  return apexPureStore.put("crew_members",id,{...current,...patch,status:patch.status||"online",heartbeatAt:new Date().toISOString()});
}

export async function crewRoster(){
  await apexPureStore.init();
  return apexPureStore.list("crew_members");
}

export async function enqueueCrewJob({role,type,payload={},priority=null,maxAttempts=5,dedupeKey=null,parentJobId=null}={}){
  const member=crewMember(role); if(!member)throw new Error("Unknown Apex crew role: "+role);
  return apexPureStore.enqueue({
    type,payload:{_apex_worker:{role:member.role,workerId:null},data:payload},
    priority:priority==null?member.priority:priority,maxAttempts,dedupeKey,parentJobId
  });
}

export async function dispatchSurface(surface,type,payload={},options={}){
  const roles=SURFACES[surface]||[];
  if(!roles.length)throw new Error("Unknown Apex surface: "+surface);
  return Promise.all(roles.map(role=>enqueueCrewJob({role,type,payload,...options,parentJobId:options.parentJobId||null})));
}

export async function crewStatus(){
  const roster=await crewRoster();
  const jobs=apexPureStore.jobs();
  return {
    members:roster,
    surfaces:Object.fromEntries(Object.keys(SURFACES).map(s=>[s,surfaceCrew(s).map(x=>x.role)])),
    jobs:{queued:jobs.filter(j=>j.status==="queued").length,running:jobs.filter(j=>j.status==="running").length,completed:jobs.filter(j=>j.status==="completed").length,dead:jobs.filter(j=>j.status==="dead").length}
  };
}
