import { uid, now } from "./id.mjs";

export const EPISODE_STAGES=Object.freeze([
  "source","hook","story","script","scenes","storyboard","visuals","audio","timeline","review","release"
]);

export function createEpisode(input={}){
  const title=String(input.title??"").trim();
  if(!title) throw new TypeError("title is required");
  const sourceRefs=[...(input.sourceRefs??[])];
  return {
    id:input.id??uid("episode"),
    title,
    passage:input.passage??"",
    sourceRefs,
    audience:input.audience??"general audience",
    tone:input.tone??"cinematic, reverent, emotionally gripping",
    visualStyle:input.visualStyle??"dark fantasy anime, sharp cel-shading, high-contrast cinematic lighting, epic and intense, highly detailed",
    storySummary:input.storySummary??"",
    hook:null,
    script:null,
    scenes:[],
    storyboard:[],
    visualBible:{characters:[],locations:[]},
    audio:[],
    timeline:null,
    releasePackage:null,
    provenance:{
      sourceRefs,
      rules:["Scripture must remain distinguishable from paraphrase, inference, history, tradition, and dramatization."]
    },
    stage:"source",
    createdAt:input.createdAt??now(),
    updatedAt:now()
  };
}

export function buildEpisodePlan(input={}){
  const episode=createEpisode(input);
  const hookPrompt=input.hookPrompt??"";
  episode.hook={
    durationSeconds:30,
    prompt:hookPrompt,
    beats:[
      {start:0,end:3,name:"pattern_interrupt"},
      {start:3,end:8,name:"stakes"},
      {start:8,end:15,name:"mystery"},
      {start:15,end:23,name:"escalation"},
      {start:23,end:30,name:"promise"}
    ]
  };
  episode.stage="hook";
  return episode;
}

export function episodeReadiness(episode={}){
  const checks=[
    ["source",Boolean(episode.passage||episode.sourceRefs?.length)],
    ["hook",Boolean(episode.hook?.prompt)],
    ["story",Boolean(episode.storySummary)],
    ["script",Boolean(episode.script)],
    ["scenes",Array.isArray(episode.scenes)&&episode.scenes.length>0],
    ["storyboard",Array.isArray(episode.storyboard)&&episode.storyboard.length>0],
    ["visuals",Array.isArray(episode.visualBible?.characters)&&Array.isArray(episode.visualBible?.locations)],
    ["audio",Array.isArray(episode.audio)],
    ["timeline",Boolean(episode.timeline)],
    ["review",Boolean(episode.reviewedAt)],
    ["release",Boolean(episode.releasePackage)]
  ];
  const missing=checks.filter(([,ok])=>!ok).map(([name])=>name);
  return {ready:missing.length===0,missing,checks:checks.map(([name,ok])=>({name,ok}))};
}

export function advanceEpisode(episode,stage){
  if(!episode||!EPISODE_STAGES.includes(stage)) throw new TypeError("Unknown episode stage");
  const index=EPISODE_STAGES.indexOf(stage);
  const current=EPISODE_STAGES.indexOf(episode.stage??"source");
  if(index<current) throw new Error("Episode cannot move backward");
  return {...episode,stage,updatedAt:now()};
}
