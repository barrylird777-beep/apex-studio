import { randomUUID } from "node:crypto";
import { CREW_CELLS, enqueueCrewJob, crewCell } from "./apex-crew.mjs";
import { apexPureStore } from "./apex-pure-store.mjs";

const SURFACE_ALIASES=Object.freeze({
  KORNKNOB:"KORNKOB",
  KORNKOB:"KORNKOB",
  "KornKob":"KORNKOB"
});

export const SURFACE_MISSIONS=Object.freeze({
  KORNKOB:{
    role:"ears",
    mission:"specialized music intelligence, discovery, history, audio analysis and supply",
    outputs:["music_research","music_model_context","audio_analysis","sound_design","music_recommendations","trend_signals"]
  },
  GardenOfApex:{
    role:"brain",
    mission:"Bible-first research plus Korn history, analytics and general useful knowledge",
    outputs:["scripture_research","cross_references","korn_history","knowledge_graph_updates","study_context","research_briefs"]
  },
  ApexStudios:{
    role:"eyes",
    mission:"direction, production, editing, mixing, mastering, search and social intelligence",
    outputs:["production_plan","shot_list","edit_plan","mix_plan","master_plan","search_results","social_analytics"]
  },
  ApexRapidVideo:{
    role:"money",
    mission:"rapid paid production, fulfillment, pricing, delivery and customer growth",
    outputs:["offer","production_packet","fulfillment_job","delivery_packet","revenue_signal"]
  },
  ApexEngine:{
    role:"money",
    mission:"reusable revenue infrastructure, automation, products and opportunity execution",
    outputs:["product_opportunity","automation","growth_plan","commerce_plan","revenue_system"]
  },
  ApexAdBlocker:{
    role:"shield",
    mission:"persistent ad/tracker blocking across supported Apple surfaces with diagnostics and rule refresh",
    outputs:["blocking_rules","dns_profile","health","failure_diagnostics","rule_refresh"]
  }
});

function canonicalSurface(surface){return SURFACE_ALIASES[String(surface)]||String(surface);}
export function surfaceMission(surface){return SURFACE_MISSIONS[canonicalSurface(surface)]||null;}

export async function dispatchSurfaceMission(surface, task, payload={}, {priority=null,dedupeKey=null,parentJobId=null}={}){
  const id=canonicalSurface(surface), mission=surfaceMission(id);
  if(!mission) throw new Error("Unknown Apex surface: "+surface);
  const correlationId=randomUUID();
  const cells=crewCell(id);
  const jobs=[];
  for(const member of cells){
    jobs.push(await enqueueCrewJob({
      role:member.role,
      type:String(task),
      payload:{surface:id,mission:mission.mission,correlationId,data:payload},
      priority:priority==null?member.priority:priority,
      dedupeKey:dedupeKey?dedupeKey+":"+member.role:null,
      parentJobId
    }));
  }
  await apexPureStore.put("surface_runs",correlationId,{
    id:correlationId,surface:id,task:String(task),status:"queued",
    crew:cells.map(x=>x.role),createdAt:new Date().toISOString()
  });
  return {correlationId,surface:id,task:String(task),crew:cells.map(x=>x.role),jobs};
}

export function surfaceCatalog(){
  return Object.fromEntries(Object.entries(SURFACE_MISSIONS).map(([id,m])=>[
    id,{...m,crew:(CREW_CELLS[id]||[])}
  ]));
}
