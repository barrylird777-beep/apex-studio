import { compileEpisode, compilerStageReport, COMPILER_STAGES } from "./episode-compiler.mjs";
import { episodeQualityGate } from "./quality-gates.mjs";
import { advanceEpisode } from "./episode-factory.mjs";
import { uid, now } from "./id.mjs";

const ACTIONS={
  source:"Attach a Scripture passage or source reference.",
  research:"Resolve source-backed research and parallel-passage context.",
  truth:"Build and validate the provenance graph before dramatization.",
  story:"Define the story spine, character desire, obstacle, escalation, reversal, and payoff.",
  script:"Write concise, filmable narration/dialogue with provenance boundaries.",
  scenes:"Turn story beats into purposeful scenes; remove filler.",
  storyboard:"Cover emotional and cinematic beats with varied shot grammar.",
  visuals:"Lock character/location continuity before generation.",
  audio:"Plan voice, music, ambience, silence, and impact sound.",
  timeline:"Assemble the edit and verify pacing.",
  review:"Run Scripture, entertainment, continuity, and production gates.",
  release:"Build the release package and publish-ready assets."
};

export function createDirectorPlan(input={}){
  const episode=compileEpisode(input);
  return directorPlan(episode);
}

export function directorPlan(episode={}){
  const report=compilerStageReport(episode);
  const quality=episodeQualityGate(episode);
  const currentIndex=COMPILER_STAGES.indexOf(episode.stage??"source");
  const next=COMPILER_STAGES.slice(currentIndex+1).find(stage=>{
    if(stage==="review") return !quality.ready;
    return true;
  })??null;
  const blockers=report.blockers??[];
  return {
    id:uid("director-plan"),
    createdAt:now(),
    episodeId:episode.id,
    currentStage:episode.stage??"source",
    nextStage:next,
    nextAction:next?ACTIONS[next]:"Episode is at the final compiler stage.",
    blockers,
    quality,
    principle:"Never trade Scripture provenance or production integrity for entertainment."
  };
}

export function directAdvance(episode,stage){
  return advanceEpisode(episode,stage);
}
