import { uid, now } from "./id.mjs";
import { auditEntertainment } from "./entertainment.mjs";

export const EPISODE_STAGES=Object.freeze([
  "source","hook","story","script","scenes","storyboard","visuals","audio","timeline","review","release"
]);

const REQUIRED={
  source:e=>Boolean(e.passage||e.sourceRefs?.length),
  hook:e=>Boolean(e.hook?.prompt),
  story:e=>Boolean(e.storySummary),
  script:e=>Boolean(e.script),
  scenes:e=>Boolean(e.scenes?.length),
  storyboard:e=>Boolean(e.storyboard?.length),
  visuals:e=>Boolean(e.visualBible?.characters?.length&&e.visualBible?.locations?.length),
  audio:e=>Boolean(e.audio?.length),
  timeline:e=>Boolean(e.timeline),
  review:e=>Boolean(e.reviewedAt),
  release:e=>Boolean(e.releasePackage)
};

export function createEpisode(input={}){
  const title=String(input.title??"").trim();
  if(!title) throw new TypeError("title is required");
  const sourceRefs=[...(input.sourceRefs??[])];
  return {
    id:input.id??uid("episode"), title, passage:input.passage??"", sourceRefs,
    audience:input.audience??"general audience",
    tone:input.tone??"cinematic, reverent, emotionally gripping",
    visualStyle:input.visualStyle??"dark fantasy anime, sharp cel-shading, high-contrast cinematic lighting, epic and intense, highly detailed",
    storySummary:input.storySummary??"", hook:null, script:null, scenes:[],
    storyboard:[], visualBible:{characters:[],locations:[]}, audio:[], timeline:null,
    releasePackage:null, entertainmentAudit:null, truthGraph:input.truthGraph??null, canonEntityIds:[...(input.canonEntityIds??[])],
    provenance:{sourceRefs,rules:["Scripture must remain distinguishable from paraphrase, inference, history, tradition, and dramatization."]},
    stage:"source", createdAt:input.createdAt??now(), updatedAt:now()
  };
}

export function buildEpisodePlan(input={}){
  const episode=createEpisode(input);
  episode.hook={durationSeconds:30,prompt:input.hookPrompt??"",beats:[
    {start:0,end:3,name:"pattern_interrupt"},{start:3,end:8,name:"stakes"},
    {start:8,end:15,name:"mystery"},{start:15,end:23,name:"escalation"},
    {start:23,end:30,name:"promise"}
  ]};
  episode.stage="hook";
  return episode;
}

export function episodeReadiness(episode={}){
  const checks=EPISODE_STAGES.map(name=>({name,ok:Boolean(REQUIRED[name]?.(episode))}));
  const entertainment=episode.entertainmentAudit??auditEntertainment(episode);
  checks.push({name:"entertainment",ok:Boolean(entertainment.ready)});
  const missing=checks.filter(x=>!x.ok).map(x=>x.name);
  return {ready:missing.length===0,missing,checks,entertainment};
}

export function episodeStageGate(episode,stage){
  if(!EPISODE_STAGES.includes(stage)) throw new TypeError("Unknown episode stage");
  const index=EPISODE_STAGES.indexOf(stage);
  const current=EPISODE_STAGES.indexOf(episode?.stage??"source");
  if(index<=current) return {ok:true,blockers:[]};
  const blockers=[];
  for(let i=0;i<index;i++){
    const name=EPISODE_STAGES[i];
    if(!REQUIRED[name]?.(episode)) blockers.push(name);
  }
  return {ok:blockers.length===0,blockers};
}

export function advanceEpisode(episode,stage){
  if(!episode||!EPISODE_STAGES.includes(stage)) throw new TypeError("Unknown episode stage");
  const index=EPISODE_STAGES.indexOf(stage);
  const current=EPISODE_STAGES.indexOf(episode.stage??"source");
  if(index<current) throw new Error("Episode cannot move backward");
  const gate=episodeStageGate(episode,stage);
  if(!gate.ok) throw new Error("Episode blocked by: "+gate.blockers.join(", "));
  return {...episode,stage,updatedAt:now()};
}
