import { uid, now } from "./id.mjs";

export const STORY_BEAT_TYPES=Object.freeze([
  "hook","question","stakes","desire","obstacle","escalation","reversal","crisis","payoff","meaning"
]);

export const STORY_PROVENANCE=Object.freeze([
  "scripture","historical","tradition","inference","dramatization"
]);

const clean=v=>String(v??"").trim();
const arr=v=>Array.isArray(v)?[...v]:[];

function normalizeBeat(input={}, index=0){
  const type=clean(input.type);
  if(!STORY_BEAT_TYPES.includes(type)) throw new TypeError(`unknown story beat type: ${type}`);
  return {
    id:input.id??uid("story-beat"),
    type,
    title:clean(input.title),
    text:clean(input.text??input.description),
    sourceRefs:arr(input.sourceRefs),
    provenance:clean(input.provenance)||"scripture",
    certainty:clean(input.certainty)||"source-backed",
    sequence:input.sequence??index,
    purpose:clean(input.purpose),
    openLoop:clean(input.openLoop),
    payoffFor:arr(input.payoffFor),
    dramatization:input.dramatization===true
  };
}

export function createStoryArchitecture(input={}){
  const architecture={
    id:input.id??uid("story-architecture"),
    episodeId:input.episodeId??null,
    passage:clean(input.passage),
    sourceRefs:arr(input.sourceRefs),
    hook:null,question:null,stakes:null,desire:null,obstacle:null,
    escalation:[],reversal:null,crisis:null,payoff:null,meaning:null,
    beats:[],openLoops:arr(input.openLoops),dramatizationCandidates:arr(input.dramatizationCandidates),
    provenanceLinks:arr(input.provenanceLinks),
    createdAt:input.createdAt??now(),
    updatedAt:now()
  };
  for(const beat of arr(input.beats)) addStoryBeat(architecture,beat);
  return architecture;
}

export function addStoryBeat(architecture,input={}){
  const beat=normalizeBeat(input,architecture.beats.length);
  architecture.beats.push(beat);
  if(beat.type==="escalation") architecture.escalation.push(beat);
  else architecture[beat.type]=beat;
  if(beat.openLoop) architecture.openLoops.push({beatId:beat.id,text:beat.openLoop});
  architecture.updatedAt=now();
  return beat;
}

export function buildStoryArchitecture({episodeId=null,passage="",sourceRefs=[],storyIntelligence={},beats=[]}={}){
  const architecture=createStoryArchitecture({episodeId,passage,sourceRefs});
  const events=arr(storyIntelligence.events);
  const claims=arr(storyIntelligence.claims);
  const source=arr(sourceRefs.length?sourceRefs:storyIntelligence.sourceRefs);
  const first=events[0];
  const last=events[events.length-1];
  const claim=claims.find(x=>x.classification==="scripture"&&x.sourceRefs?.length)||claims[0];

  const add=(type,text,extra={})=>{
    if(!clean(text)) return null;
    return addStoryBeat(architecture,{type,text,sourceRefs:arr(extra.sourceRefs?.length?extra.sourceRefs:source),provenance:extra.provenance??"scripture",certainty:extra.certainty??"source-backed",purpose:extra.purpose,openLoop:extra.openLoop,dramatization:extra.dramatization});
  };

  add("hook",first?.title||claim?.text||"A Scripture-backed story begins with a question that demands an answer.",{openLoop:"What happens next?",purpose:"Create immediate curiosity without adding unsupported facts."});
  add("question",first?.description?clean(first.description):"What does the source actually reveal, and what remains unknown?",{purpose:"Frame the central narrative question."});
  if(storyIntelligence.conflicts?.length) add("stakes",storyIntelligence.conflicts[0].text??storyIntelligence.conflicts[0].description??"A source-backed conflict must be resolved.",{purpose:"Clarify consequences from the source."});
  else if(claim) add("stakes",claim.text,{purpose:"Anchor stakes in source-backed material."});
  if(first) add("desire",first.description||first.title,{purpose:"Use the clearest source-backed character or event objective; do not invent motives."});
  if(events.length>1) add("obstacle",events[1].description||events[1].title,{purpose:"Use the next documented conflict or constraint."});
  for(const event of events.slice(2,5)) add("escalation",event.description||event.title,{purpose:"Increase pressure using documented events only."});
  if(events.length>5) add("reversal",events[Math.floor(events.length/2)].description||events[Math.floor(events.length/2)].title,{purpose:"Mark a documented change in direction; never manufacture a twist."});
  if(last) add("crisis",last.description||last.title,{purpose:"Frame the final source-backed turning point."});
  if(last) add("payoff",last.description||last.title,{purpose:"Pay off the central question with the source's outcome."});
  if(claim) add("meaning",claim.text,{purpose:"Separate explicit Scripture from interpretation."});
  for(const beat of arr(beats)) addStoryBeat(architecture,beat);
  return architecture;
}

export function auditStoryArchitecture(architecture={}){
  const blockers=[];
  if(!clean(architecture.passage)) blockers.push({code:"passage-missing"});
  if(!arr(architecture.sourceRefs).length) blockers.push({code:"source-refs-missing"});
  const beats=arr(architecture.beats);
  if(!beats.length) blockers.push({code:"beats-empty"});
  const ids=new Set(beats.map(x=>x.id));
  const required=["hook","question","stakes","obstacle","payoff"];
  for(const type of required){
    if(!architecture[type]||!clean(architecture[type].text)) blockers.push({code:"required-beat-missing",type});
  }
  for(const beat of beats){
    if(!STORY_BEAT_TYPES.includes(beat.type)) blockers.push({code:"invalid-beat-type",id:beat.id});
    if(!STORY_PROVENANCE.includes(beat.provenance)) blockers.push({code:"invalid-provenance",id:beat.id});
    if(!arr(beat.sourceRefs).length&&!beat.dramatization) blockers.push({code:"beat-provenance-missing",id:beat.id});
    for(const id of arr(beat.payoffFor)) if(!ids.has(id)) blockers.push({code:"payoff-reference-missing",id:beat.id,reference:id});
  }
  const sequence=beats.map(x=>x.sequence);
  if(sequence.some((v,i)=>i&&v<sequence[i-1])) blockers.push({code:"beat-sequence-invalid"});
  return {ready:blockers.length===0,blockers,stats:{beats:beats.length,openLoops:arr(architecture.openLoops).length,dramatizationCandidates:arr(architecture.dramatizationCandidates).length,provenanceLinks:arr(architecture.provenanceLinks).length}};
}

export function storyArchitecturePrompt({passage="",sourceRefs=[],storyIntelligence={}}={}){
  return `Build a compelling story architecture from verified Bible source analysis.

PASSAGE:
${passage}

SOURCE REFERENCES:
${arr(sourceRefs).join(", ")}

VERIFIED STORY INTELLIGENCE:
${JSON.stringify(storyIntelligence,null,2)}

Return a story spine with hook, question, stakes, desire, obstacle, escalation, reversal, crisis, payoff, and meaning. Every factual beat must carry exact source references and a provenance class: scripture, historical, tradition, inference, or dramatization. Keep invented connective tissue explicitly labeled as dramatization or inference. Do not invent dialogue, motives, events, chronology, miracles, relationships, or outcomes. Prefer visual action and short speakable beats. Preserve unresolved questions rather than fabricating answers.`;
}
