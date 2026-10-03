import crypto from "node:crypto";

export const PERMANENT_WORKERS = Object.freeze([
  ["editor-core","Editor Core","timeline, trimming, snapping, ripple edits, keyframes, transitions, undo/redo"],
  ["video-engine","Video Engine","decode, proxies, compositing, color, effects, frame accuracy, render performance"],
  ["audio-engine","Audio Engine","mixing, loudness, ducking, cleanup, time-stretch, synchronization"],
  ["voiceover","Voiceover","voice catalog, synthesis, pronunciation, long-form stitching, provider failover"],
  ["captions","Captions","subtitles, timing, styling, animation, accessibility, import/export"],
  ["export","Export","H.264, H.265, AV1, 4K/60, presets, bitrate, batch export, recovery"],
  ["editor-ux","Editor UX","keyboard workflows, selection, snapping, inspector, preview, recovery"],
  ["editor-qa","Editor QA","media edge cases, regression tests, export validation, data integrity"],
  ["media-ingest","Media Ingest","upload, probing, thumbnails, metadata, proxies, asset validation"],
  ["project-storage","Project Storage","autosave, versioning, snapshots, recovery, storage integrity"],
  ["render-cache","Render Cache","incremental renders, cache reuse, invalidation, preview acceleration"],
  ["performance","Performance","latency, memory, CPU/GPU utilization, bottleneck detection, profiling"],
  ["infrastructure","Infrastructure","workers, queues, providers, deployment health, horizontal scaling"],
  ["automation","Automation","scheduling, retries, deduplication, checkpoints, recovery, balancing"],
  ["observability","Observability","metrics, health checks, logs, failure detection, operational telemetry"],
  ["knowledge-research","Research","source-backed historical and reference research with provenance"],
  ["genealogy","Genealogy","explicit textual ancestry and kinship evidence with uncertainty"],
  ["textual-traditions","Textual Traditions","canon, translations, manuscripts, textual variants, provenance"],
  ["world-knowledge","World Knowledge","geography, chronology, cultures, institutions, reference data"],
  ["chronology","Chronology","date ranges, relative chronology, uncertainty tracking"],
  ["visual-direction","Visual Direction","camera, lighting, composition, continuity, historical visual reference"],
  ["audio-reference","Audio Reference","pronunciation, transliteration, prosody, naming and sound metadata"],
  ["publishing","Publishing","metadata, indexes, provenance, packaging, retrieval-ready exports"],
  ["accessibility","Accessibility","captions, contrast, keyboard access, audio descriptions, export checks"],
  ["release-qa","Release QA","integration validation, smoke tests, deployment readiness, rollback checks"]
]);

const now=()=>new Date().toISOString();

export function createPermanentWorker(input={}) {
  const [role,name,job]=PERMANENT_WORKERS.find(x=>x[0]===input.role)??[
    String(input.role||"general"),
    String(input.name||"Apex Worker"),
    String(input.job||"continuous maintenance")
  ];
  return {
    id:input.id??`worker-${role}-${crypto.randomUUID()}`,
    role,name,permanent:true,
    job:input.job??job,
    status:"idle",
    startedAt:null,
    lastHeartbeatAt:null,
    completed:0,
    failed:0,
    currentTask:null,
    createdAt:now()
  };
}

export function createPermanentWorkerFleet(input={}) {
  return {
    id:input.id??crypto.randomUUID(),
    status:"stopped",
    createdAt:now(),
    workers:PERMANENT_WORKERS.map(([role])=>createPermanentWorker({role}))
  };
}

export function startPermanentWorker(worker) {
  return {...worker,status:"running",startedAt:worker.startedAt??now(),lastHeartbeatAt:now()};
}

export function heartbeatPermanentWorker(worker,task=null) {
  return {...worker,status:"running",lastHeartbeatAt:now(),currentTask:task};
}

export function completePermanentWorkerTask(worker) {
  return {...worker,status:"running",lastHeartbeatAt:now(),currentTask:null,completed:Number(worker.completed||0)+1};
}

export function failPermanentWorkerTask(worker,error) {
  return {...worker,status:"running",lastHeartbeatAt:now(),currentTask:null,failed:Number(worker.failed||0)+1,lastError:String(error)};
}

export function fleetStatus(fleet={}) {
  const workers=Array.isArray(fleet.workers)?fleet.workers:[];
  return {
    status:fleet.status||"stopped",
    total:workers.length,
    running:workers.filter(w=>w.status==="running").length,
    idle:workers.filter(w=>w.status==="idle").length,
    failed:workers.filter(w=>w.status==="failed").length,
    workers
  };
}
