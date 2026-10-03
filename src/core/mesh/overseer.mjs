import crypto from "node:crypto";

const ROLE_TASKS = Object.freeze({
  "editor-core":"continuous editor operation validation","video-engine":"continuous video pipeline health validation","audio-engine":"continuous audio pipeline health validation","voiceover":"continuous voice provider and queue health validation","captions":"continuous caption timing and accessibility validation","export":"continuous export pipeline validation","editor-ux":"continuous editor interaction validation","editor-qa":"continuous regression and media integrity validation","media-ingest":"continuous ingest and asset validation","project-storage":"continuous autosave and recovery validation","render-cache":"continuous cache integrity and invalidation validation","performance":"continuous performance telemetry validation","infrastructure":"continuous worker and runtime health validation","automation":"continuous queue retry and checkpoint validation","observability":"continuous metrics and failure detection","knowledge-research":"continuous source provenance validation","genealogy":"continuous evidence integrity validation","textual-traditions":"continuous textual provenance validation","world-knowledge":"continuous reference data validation","chronology":"continuous chronology consistency validation","visual-direction":"continuous visual reference metadata validation","audio-reference":"continuous pronunciation and audio metadata validation","publishing":"continuous packaging and metadata validation","accessibility":"continuous accessibility validation","release-qa":"continuous release readiness validation"
});
const now=()=>new Date().toISOString();

export function createOverseer(input={}) {
  return {id:input.id??crypto.randomUUID(),name:input.name??"Apex Overseer",status:"running",startedAt:now(),lastCycleAt:null,cycleCount:0,assignments:0,staleWorkers:0,failuresObserved:0,intervalMs:Math.max(1000,Number(input.intervalMs)||15000),staleAfterMs:Math.max(5000,Number(input.staleAfterMs)||45000)};
}
export function overseerTaskFor(worker){ return ROLE_TASKS[worker?.role] ?? "continuous:general worker health validation"; }
export function overseerCycle(overseer,fleet){
  const ts=Date.now(); let assignments=0,staleWorkers=0,failuresObserved=0;
  for(const worker of Array.isArray(fleet?.workers)?fleet.workers:[]) {
    if(worker.status==="failed") failuresObserved++;
    const last=Date.parse(worker.lastHeartbeatAt||worker.startedAt||0);
    if(!Number.isFinite(last)||ts-last>overseer.staleAfterMs) staleWorkers++;
    if(worker.status==="running"){worker.currentTask=worker.currentTask||overseerTaskFor(worker);worker.lastHeartbeatAt=now();assignments++;}
  }
  return {...overseer,status:"running",lastCycleAt:now(),cycleCount:Number(overseer.cycleCount||0)+1,assignments:Number(overseer.assignments||0)+assignments,staleWorkers,failuresObserved:Number(overseer.failuresObserved||0)+failuresObserved};
}
export function overseerStatus(overseer,fleet){
  const workers=Array.isArray(fleet?.workers)?fleet.workers:[];
  return {...overseer,workerCount:workers.length,runningWorkers:workers.filter(w=>w.status==="running").length,activeAssignments:workers.filter(w=>Boolean(w.currentTask)).length,staleWorkers:workers.filter(w=>{const last=Date.parse(w.lastHeartbeatAt||w.startedAt||0);return !Number.isFinite(last)||Date.now()-last>overseer.staleAfterMs;}).length};
}
export default createOverseer;