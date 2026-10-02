import { uid, now } from "./id.mjs";
import { episodeQualityGate } from "./quality-gates.mjs";
import { auditContinuity } from "./continuity-engine.mjs";
import { auditStoryArchitecture } from "./story-architect.mjs";
import { auditStoryIntelligence } from "./story-intelligence.mjs";
import { auditStoryboard } from "./storyboard.mjs";
import { auditScenes } from "./scene-purpose.mjs";

const arr=v=>Array.isArray(v)?v:[];
const priority={blocker:0,warning:1,info:2};

function finding(input={}) {
  return {id:input.id??uid("finding"),severity:input.severity??"warning",domain:input.domain??"production",code:input.code??"production-finding",message:String(input.message??""),repair:input.repair??null,dependencies:arr(input.dependencies),createdAt:now()};
}

export function diagnoseEpisode({episode={},canon={},characters=[],previousCharacters=[]}={}) {
  const intelligence=episode.storyIntelligence?auditStoryIntelligence(episode.storyIntelligence):{ready:false,blockers:[{code:"analysis-missing",message:"Story Intelligence is missing."}]};
  const architecture=episode.storyArchitecture?auditStoryArchitecture(episode.storyArchitecture):{ready:false,blockers:[{code:"architecture-missing",message:"Story Architecture is missing."}]};
  const continuity=auditContinuity({canon,episode,characters,previousCharacters});
  const scenes=auditScenes(episode.scenes??[]);
  const storyboard=auditStoryboard(episode.storyboard??[]);
  const quality=episodeQualityGate(episode);
  const findings=[];
  for(const item of [...intelligence.blockers]) findings.push(finding({severity:"blocker",domain:"intelligence",code:item.code,message:item.message,repair:"complete Story Intelligence",dependencies:["story-intelligence"]}));
  for(const item of [...architecture.blockers]) findings.push(finding({severity:"blocker",domain:"story",code:item.code,message:item.message,repair:"repair Story Architecture",dependencies:["story-intelligence","story-architecture"]}));
  for(const item of [...continuity.blockers,...continuity.warnings]) findings.push(finding({severity:item.severity,domain:"continuity",code:item.code,message:item.message,repair:"repair continuity",dependencies:["canon","continuity"]}));
  for(const item of [...scenes.blockers]) findings.push(finding({severity:"blocker",domain:"scenes",code:item.code,message:item.message,repair:"repair scene blueprint",dependencies:["story-architecture"]}));
  for(const item of [...storyboard.blockers]) findings.push(finding({severity:"blocker",domain:"storyboard",code:item.code,message:item.message,repair:"repair storyboard coverage",dependencies:["scenes","cinematic-director"]}));
  for(const gate of arr(quality.gates).filter(g=>!g.ok)) findings.push(finding({severity:"blocker",domain:gate.name,code:"quality-gate-blocked",message:`${gate.name} quality gate is blocked.`,repair:`repair ${gate.name}`,dependencies:[gate.name]}));
  findings.sort((a,b)=>priority[a.severity]-priority[b.severity]);
  const blockers=findings.filter(x=>x.severity==="blocker");
  const repairs=[...new Map(findings.filter(x=>x.repair).map(x=>[x.repair,{action:x.repair,dependencies:x.dependencies,blockedBy:[]}])).values()];
  for(const repair of repairs) repair.blockedBy=repairs.filter(other=>other!==repair&&repair.dependencies.some(dep=>other.action.includes(dep))).map(x=>x.action);
  return {id:uid("diagnosis"),ready:blockers.length===0,findings,repairs,quality,stats:{findings:findings.length,blockers:blockers.length,repairs:repairs.length},createdAt:now()};
}

export function repairPlan(diagnosis={}) {
  const repairs=arr(diagnosis.repairs);
  const ready=repairs.filter(r=>!r.blockedBy?.length);
  return {steps:ready.map((r,index)=>({order:index+1,action:r.action,dependencies:r.dependencies})),remaining:repairs.filter(r=>r.blockedBy?.length),ready:diagnosis.ready};
}

export function productionDoctorPrompt({diagnosis={}}={}) {
  return `You are Apex Production Doctor. Repair only the highest-priority blocked subsystem first. Preserve Scripture provenance and locked canon. Do not invent evidence. Diagnosis: ${JSON.stringify(diagnosis)}. Return a concrete repair plan with affected artifacts, validation checks, and the next audit to run.`;
}
