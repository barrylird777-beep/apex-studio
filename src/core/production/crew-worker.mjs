import { MultiAiCoordinator } from "./../mesh/multi-ai-coordinator.mjs";
import { GeminiMeshProvider } from "./../mesh/gemini-mesh-provider.mjs";
import { ClaudeMeshProvider } from "./../mesh/claude-mesh-provider.mjs";
import { claimNextWorkerTasks, completeWorkerTask, failWorkerTask, heartbeatWorkerTask } from "./../mesh/durable-worker-store.mjs";
import * as crew from "./crew-primitives.mjs";

const TYPES=["BIBLE_FIND","STORY_BREAKDOWN","CHARACTER_CASTING","SHOT_PLANNING","ASSET_GENERATION","SOUND_GENERATION","EDITORIAL_MASTER"];
export function startCrewWorker({concurrency=Math.max(1,Number(process.env.APEX_CREW_CONCURRENCY||32))}={}){
  const coordinator=new MultiAiCoordinator({providers:{gemini:new GeminiMeshProvider(),claude:new ClaudeMeshProvider()}});
  let stopped=false;const running=new Set();
  const handlers={
    BIBLE_FIND:crew.handleBibleFinderTask,STORY_BREAKDOWN:crew.handleStoryCrewTask,CHARACTER_CASTING:crew.handleCastingCrewTask,
    SHOT_PLANNING:crew.handleShotPlanningTask,ASSET_GENERATION:crew.handleAssetGenTask,SOUND_GENERATION:crew.handleVoiceSoundTask,
    EDITORIAL_MASTER:crew.handleMasteringTask
  };
  async function run(task){const hb=setInterval(()=>void heartbeatWorkerTask(task.id,120000,task.lease_token).catch(()=>{}),30000);try{const fn=handlers[task.task];if(!fn)throw Error("UnknownCrewTask:"+task.task);const result=await fn(task.payload||{},task.payload?.projectId??null,coordinator);await completeWorkerTask(task.id,result,task.lease_token)}catch(e){await failWorkerTask(task.id,e,task.lease_token)}finally{clearInterval(hb);running.delete(task.id)}}
  async function pump(){if(stopped)return;try{for(const type of TYPES){if(running.size>=concurrency)break;const slots=concurrency-running.size,tasks=await claimNextWorkerTasks(Math.min(slots,8),120000,type);for(const t of tasks){running.add(t.id);void run(t)}}}catch(e){console.error("[crew-worker]",e?.message||e)}finally{if(!stopped)setTimeout(pump,running.size?25:250).unref?.()}}
  void pump();return{stop(){stopped=true},status(){return{running:running.size,concurrency,TYPES}}};
}
