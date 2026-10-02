import { auditTruthGraph, buildTruthGraphFromEpisode } from "./truth-graph.mjs";
import { auditEntertainment } from "./entertainment.mjs";
import { auditStoryboard } from "./storyboard.mjs";
import { auditScenes } from "./scene-purpose.mjs";
import { canRelease } from "./agent-crew.mjs";

function result(name,ok,detail,blocker=false){ return {name,ok,detail,blocker}; }

export function scriptureGate(episode={}){
  const graph=episode.truthGraph??buildTruthGraphFromEpisode(episode);
  const audit=auditTruthGraph(graph);
  const sourceAttached=Boolean(episode.passage||episode.sourceRefs?.length);
  const blockers=[...audit.blockers];
  if(!sourceAttached) blockers.push(result("source-attached",false,"Episode has no passage or source references.",true));
  return {name:"scripture",ok:blockers.length===0,blockers,audit,checks:[
    result("source-attached",sourceAttached,"Episode has a passage or source references.",true),
    result("provenance-graph",audit.ready,"Truth claims have valid provenance and source boundaries.",true)
  ]};
}

export function entertainmentGate(episode={}){
  const audit=episode.entertainmentAudit??auditEntertainment(episode);
  const coreNames=["hook","open_loop","pacing_variation","source_provenance","dramatization_boundary","filler_control"];
  const core=audit.checks.filter(x=>coreNames.includes(x.name));
  const blockers=core.filter(x=>!x.ok);
  return {name:"entertainment",ok:blockers.length===0,blockers,audit};
}

export function productionDoctorGate(episode={}){
  const checks=[
    result("story-grounded",Boolean(episode.truthGraph||episode.storyIntelligence),"Story has source-grounded intelligence.",true),
    result("story-structured",Boolean(episode.storyArchitecture||episode.storyPlan),"Story has an explicit architecture/plan.",true),
    result("continuity-reviewed",Boolean(episode.continuityAudit||episode.storyboard?.length),"Production has continuity evidence.",true),
    result("production-artifacts",Boolean(episode.script&&episode.scenes?.length&&episode.storyboard?.length&&episode.timeline),"Core production artifacts are present.",true)
  ];
  const blockers=checks.filter(x=>!x.ok);
  return {name:"production-doctor",ok:blockers.length===0,blockers,checks};
}

export function sceneGate(episode={}){ const audit=auditScenes(episode.scenes); return {name:"scenes",ok:audit.ready,blockers:audit.blockers,audit}; }

export function continuityGate(episode={}){
  const shots=Array.isArray(episode.storyboard)?episode.storyboard:[];
  const audit=auditStoryboard(shots);
  return {name:"continuity",ok:audit.ready,blockers:audit.blockers,audit};
}

export function productionGate(episode={}){
  const checks=[
    result("script",Boolean(episode.script),"Script exists.",true),
    result("scenes",Array.isArray(episode.scenes)&&episode.scenes.length>0,"Scenes exist.",true),
    result("storyboard",Array.isArray(episode.storyboard)&&episode.storyboard.length>0,"Storyboard exists.",true),
    result("visual-bible",Boolean(episode.visualBible?.characters?.length&&episode.visualBible?.locations?.length),"Character and location bibles exist.",true),
    result("audio",Array.isArray(episode.audio)&&episode.audio.length>0,"Audio plan exists.",true),
    result("timeline",Boolean(episode.timeline),"Timeline exists.",true)
  ];
  const blockers=checks.filter(x=>!x.ok);
  return {name:"production",ok:blockers.length===0,blockers,checks};
}

export function releaseGate(episode={}){
  const packageReady=Boolean(episode.releasePackage);
  const pkg=episode.releasePackage??{};\n  const approvalInput={action:"release",artifactIds:[pkg.id].filter(Boolean),episodeId:episode.id??episode.agentCrew?.episodeId??null,version:pkg.version??episode.version??null};\n  const authorityReady=canRelease(episode.agentCrew??{approval:{required:true,status:"pending"}},approvalInput);
  const blockers=[];
  if(!packageReady) blockers.push(result("release-package",false,"Release package is missing.",true));
  if(!authorityReady) blockers.push(result("human-approval",false,"Final human approval is required before release.",true));
  return {name:"release",ok:blockers.length===0,blockers};
}

export function episodeQualityGate(episode={}){
  const gates=[scriptureGate(episode),entertainmentGate(episode),sceneGate(episode),continuityGate(episode),productionGate(episode),productionDoctorGate(episode)];
  const blockers=gates.flatMap(g=>g.blockers??[]);
  return {ready:blockers.length===0,gates,blockers,release:releaseGate(episode),
    summary:{gateCount:gates.length,passed:gates.filter(g=>g.ok).length,blocked:gates.filter(g=>!g.ok).length}};
}
