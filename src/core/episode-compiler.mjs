import { createEpisode } from "./episode-factory.mjs";
import { buildTruthGraphFromEpisode } from "./truth-graph.mjs";
import { episodeQualityGate } from "./quality-gates.mjs";
import { uid, now } from "./id.mjs";
import { canonContext } from "./world-canon.mjs";
import { auditStoryArchitecture, buildStoryArchitecture } from "./story-architect.mjs";
import { createStoryIntelligence, auditStoryIntelligence } from "./story-intelligence.mjs";
import { createStoryArchitecture, auditStoryArchitecture, buildStoryArchitecture } from "./story-architect.mjs";

export const COMPILER_STAGES=Object.freeze([
  "source","research","truth","story","script","scenes","storyboard","visuals","audio","timeline","review","release"
]);

export function compileEpisode(input={}){
  const episode=createEpisode(input);
  episode.id=input.id??episode.id;
  episode.truthGraph=input.truthGraph??buildTruthGraphFromEpisode(episode);
  episode.storyIntelligence=input.storyIntelligence??null;
  episode.storyArchitecture=input.storyArchitecture??(episode.storyIntelligence?buildStoryArchitecture({episodeId:episode.id,passage:episode.passage,sourceRefs:episode.sourceRefs,storyIntelligence:episode.storyIntelligence}):null);
  episode.storyArchitectureAudit=episode.storyArchitecture?auditStoryArchitecture(episode.storyArchitecture):null;
  episode.storyIntelligence=input.storyIntelligence??createStoryIntelligence({episodeId:episode.id,passage:episode.passage,sourceRefs:episode.sourceRefs});
  episode.canonContext=input.worldCanon?canonContext(input.worldCanon,episode.canonEntityIds):{entities:[],relationships:[],events:[],motifs:[]};
  episode.compiler={
    id:uid("compile"),
    version:1,
    stages:COMPILER_STAGES.map(name=>({name,status:name==="source"?"ready":"pending"})),
    generatedAt:now()
  };
  episode.storyIntelligenceAudit=auditStoryIntelligence(episode.storyIntelligence);
  episode.storyArchitecture=input.storyArchitecture??buildStoryArchitecture({episodeId:episode.id,passage:episode.passage,sourceRefs:episode.sourceRefs,storyIntelligence:episode.storyIntelligence});
  episode.storyArchitectureAudit=auditStoryArchitecture(episode.storyArchitecture);
  episode.qualityGate=episodeQualityGate(episode);
  episode.compiler.rules={provenanceLocked:true,scenePurposeRequired:true,cinematicCoverageRequired:true,canonContinuityRequired:true,storyArchitectureRequired:true,storyArchitectureRequired:true,storyIntelligenceRequired:true,storyArchitectureRequired:true};
  episode.compiler.canon={entityIds:[...episode.canonEntityIds],entityCount:episode.canonContext.entities.length};
  return episode;
}

export function compilerStageReport(episode={}){
  const stage=episode.stage??"source";
  const quality=episodeQualityGate(episode);
  return {
    stage,
    stages:COMPILER_STAGES.map(name=>({name,status:name===stage?"current":COMPILER_STAGES.indexOf(name)<COMPILER_STAGES.indexOf(stage)?"complete":"pending"})),
    quality,
    blockers:quality.blockers
  };
}

export function canCompileToStage(episode,stage){
  if(!COMPILER_STAGES.includes(stage)) throw new TypeError("Unknown compiler stage");
  const index=COMPILER_STAGES.indexOf(stage);
  const current=COMPILER_STAGES.indexOf(episode.stage??"source");
  if(index<=current) return {ok:true,blockers:[]};
  const required={
    research:["source"],
    truth:["source"],
    story:["truth","storyIntelligence","storyArchitecture"],
    script:["story"],
    scenes:["script"],
    storyboard:["scenes"],
    visuals:["storyboard"],
    audio:["visuals"],
    timeline:["audio"],
    review:["timeline"],
    release:["review"]
  };
  const blockers=[];
  for(const name of required[stage]??[]){
    const checks={
      source:Boolean(episode.passage||episode.sourceRefs?.length),
      truth:Boolean(episode.truthGraph),
      storyArchitecture:Boolean(episode.storyArchitectureAudit?.ready),
      storyArchitecture:Boolean(episode.storyArchitectureAudit?.ready),
      storyIntelligence:Boolean(episode.storyIntelligenceAudit?.ready),
      storyArchitecture:Boolean(episode.storyArchitectureAudit?.ready),
      story:Boolean(episode.storySummary),
      script:Boolean(episode.script),
      scenes:Boolean(episode.scenes?.length),
      storyboard:Boolean(episode.storyboard?.length),
      visuals:Boolean(episode.visualBible?.characters?.length&&episode.visualBible?.locations?.length),
      audio:Boolean(episode.audio?.length),
      timeline:Boolean(episode.timeline),
      review:Boolean(episode.reviewedAt)
    };
    if(!checks[name]) blockers.push(name);
  }
  return {ok:blockers.length===0,blockers};
}
