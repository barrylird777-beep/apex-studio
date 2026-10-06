import { compileEpisode, compilerStageReport, COMPILER_STAGES } from "./episode-compiler.mjs";
import { episodeQualityGate } from "./quality-gates.mjs";
import { advanceEpisode } from "./episode-factory.mjs";
import { uid, now } from "./id.mjs";

const ACTIONS={
 source:"Attach a Scripture passage or source reference.",
 research:"Resolve source-backed research and parallel-passage context.",
 truth:"Build and validate the provenance graph before dramatization.",
 story:"Build and validate the source-bounded story spine: hook, question, stakes, desire, obstacle, escalation, reversal, crisis, payoff, and meaning.",
 script:"Write concise, filmable narration/dialogue with explicit provenance boundaries.",
 scenes:"Turn story beats into purposeful scenes; remove filler and repetitive exposition.",
 storyboard:"Create varied cinematic coverage with purposeful camera language and continuity references.",
 visuals:"Lock character/location continuity before generation; reject inconsistent designs.",
 audio:"Request verified audio packages from Music Radar: narration, dialogue, music, ambience, SFX, sound design, mix, and master.",
 timeline:"Assemble the edit and verify pacing, scene transitions, and payoff timing.",
 review:"Run Scripture, entertainment, continuity, and production gates.",
 release:"Build the release package and publish-ready assets."
};

function highestPriorityBlocker(quality){
 for(const gate of quality.gates??[]){
   if(!gate.ok && gate.blockers?.length) return {gate:gate.name,blockers:gate.blockers};
 }
 return null;
}

export function createDirectorPlan(input={}){
 const episode=compileEpisode(input);
 return {...directorPlan(episode),episode};
}

export function directorPlan(episode={}){
 const report=compilerStageReport(episode);
 const quality=episodeQualityGate(episode);
 const currentIndex=COMPILER_STAGES.indexOf(episode.stage??"source");
 const next=COMPILER_STAGES.slice(currentIndex+1).find(stage=>stage!=="review"||!quality.ready)??null;
 const priority=highestPriorityBlocker(quality);
 return {
  id:uid("director-plan"),createdAt:now(),episodeId:episode.id,currentStage:episode.stage??"source",
  nextStage:next,nextAction:next?ACTIONS[next]:"Episode is at the final compiler stage.",
  blockers:report.blockers??[],priorityBlocker:priority,quality,
  decisionRules:[
   "Never trade Scripture provenance for entertainment.",
   "Never turn inference or dramatization into an unmarked Scripture claim.",
   "Never advance past a blocked production stage.",
   "Every scene must have a narrative purpose.",
   "Every shot must have a visual or emotional purpose.",
   "Continuity errors are production blockers, not cosmetic warnings."
  ]
 };
}

export function directAdvance(episode,stage){ return advanceEpisode(episode,stage); }
