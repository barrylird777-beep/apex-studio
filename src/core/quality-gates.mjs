import { auditTruthGraph, buildTruthGraphFromEpisode } from "./truth-graph.mjs";
import { auditEntertainment } from "./entertainment.mjs";
import { auditStoryboard } from "./storyboard.mjs";
import { auditScenes } from "./scene-purpose.mjs";
import { auditStoryArchitecture } from "./story-architect.mjs";
import { auditStoryIntelligence } from "./story-intelligence.mjs";

function result(name,ok,detail,blocker=false){ return {name,ok,detail,blocker}; }

export function scriptureGate(episode={}){
  const graph=episode.truthGraph??buildTruthGraphFromEpisode(episode);
  const audit=auditTruthGraph(graph);
  return {name:"scripture",ok:audit.ready,blockers:audit.blockers,audit,checks:[
    result("source-attached",Boolean(episode.passage||episode.sourceRefs?.length),"Episode has a passage or source references.",true),
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

export function storyArchitectureGate(episode={}){ const audit=auditStoryArchitecture(episode.storyArchitecture); return {name:"story-architecture",ok:audit.ready,blockers:audit.blockers,audit}; }

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
  const ok=Boolean(episode.releasePackage);
  return {name:"release",ok,blockers:ok?[]:[result("release-package",false,"Release package is missing.",true)]};
}

export function storyIntelligenceGate(episode={}) {
 const audit=auditStoryIntelligence(episode.storyIntelligence);
 return {name:"story-intelligence",ok:audit.ready,blockers:audit.blockers,audit};
}

export function episodeQualityGate(episode={}){
  const gates=[scriptureGate(episode),storyIntelligenceGate(episode),storyArchitectureGate(episode),entertainmentGate(episode),sceneGate(episode),continuityGate(episode),productionGate(episode)];
  const blockers=gates.flatMap(g=>g.blockers??[]);
  return {ready:blockers.length===0,gates,blockers,release:releaseGate(episode),
    summary:{gateCount:gates.length,passed:gates.filter(g=>g.ok).length,blocked:gates.filter(g=>!g.ok).length}};
}
