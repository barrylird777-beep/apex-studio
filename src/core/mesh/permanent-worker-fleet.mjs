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

const WORKER_ASSIGNMENTS = Object.freeze([["w01","editor-core","timeline/edit operations; primary specialist"],["w02","editor-core","timeline/edit operations; secondary specialist"],["w03","editor-core","timeline/edit operations; validation specialist"],["w04","video-engine","decode/render/compositing; performance specialist"],["w05","video-engine","decode/render/compositing; reliability specialist"],["w06","video-engine","decode/render/compositing; integration specialist"],["w07","audio-engine","mixing/sync/mastering; recovery specialist"],["w08","audio-engine","mixing/sync/mastering; optimization specialist"],["w09","audio-engine","mixing/sync/mastering; edge-cases specialist"],["w10","voiceover","TTS/provider failover; automation specialist"],["w11","voiceover","TTS/provider failover; telemetry specialist"],["w12","voiceover","TTS/provider failover; security specialist"],["w13","captions","caption timing/accessibility; compatibility specialist"],["w14","captions","caption timing/accessibility; scalability specialist"],["w15","captions","caption timing/accessibility; regression specialist"],["w16","export","codec/export pipelines; tooling specialist"],["w17","export","codec/export pipelines; primary specialist"],["w18","export","codec/export pipelines; secondary specialist"],["w19","editor-ux","controls/inspector/preview; validation specialist"],["w20","editor-ux","controls/inspector/preview; performance specialist"],["w21","editor-ux","controls/inspector/preview; reliability specialist"],["w22","editor-qa","editor regression/media validation; integration specialist"],["w23","editor-qa","editor regression/media validation; recovery specialist"],["w24","editor-qa","editor regression/media validation; optimization specialist"],["w25","media-ingest","uploads/probing/proxies; edge-cases specialist"],["w26","media-ingest","uploads/probing/proxies; automation specialist"],["w27","media-ingest","uploads/probing/proxies; telemetry specialist"],["w28","project-storage","autosave/versioning/recovery; security specialist"],["w29","project-storage","autosave/versioning/recovery; compatibility specialist"],["w30","project-storage","autosave/versioning/recovery; scalability specialist"],["w31","render-cache","cache/invalidation/previews; regression specialist"],["w32","render-cache","cache/invalidation/previews; tooling specialist"],["w33","render-cache","cache/invalidation/previews; primary specialist"],["w34","performance","CPU/RAM/latency profiling; secondary specialist"],["w35","performance","CPU/RAM/latency profiling; validation specialist"],["w36","performance","CPU/RAM/latency profiling; performance specialist"],["w37","infrastructure","workers/queues/deployments; reliability specialist"],["w38","infrastructure","workers/queues/deployments; integration specialist"],["w39","infrastructure","workers/queues/deployments; recovery specialist"],["w40","automation","scheduling/retries/checkpoints; optimization specialist"],["w41","automation","scheduling/retries/checkpoints; edge-cases specialist"],["w42","automation","scheduling/retries/checkpoints; automation specialist"],["w43","observability","metrics/health/logs; telemetry specialist"],["w44","observability","metrics/health/logs; security specialist"],["w45","observability","metrics/health/logs; compatibility specialist"],["w46","knowledge-research","source-backed reference research; scalability specialist"],["w47","knowledge-research","source-backed reference research; regression specialist"],["w48","knowledge-research","source-backed reference research; tooling specialist"],["w49","genealogy","textual ancestry/kinship evidence; primary specialist"],["w50","genealogy","textual ancestry/kinship evidence; secondary specialist"],["w51","genealogy","textual ancestry/kinship evidence; validation specialist"],["w52","textual-traditions","manuscripts/translations/variants; performance specialist"],["w53","textual-traditions","manuscripts/translations/variants; reliability specialist"],["w54","textual-traditions","manuscripts/translations/variants; integration specialist"],["w55","world-knowledge","geography/chronology/reference; recovery specialist"],["w56","world-knowledge","geography/chronology/reference; optimization specialist"],["w57","world-knowledge","geography/chronology/reference; edge-cases specialist"],["w58","chronology","dates/ranges/uncertainty; automation specialist"],["w59","chronology","dates/ranges/uncertainty; telemetry specialist"],["w60","chronology","dates/ranges/uncertainty; security specialist"],["w61","visual-direction","camera/light/composition; compatibility specialist"],["w62","visual-direction","camera/light/composition; scalability specialist"],["w63","visual-direction","camera/light/composition; regression specialist"],["w64","audio-reference","pronunciation/transliteration/audio metadata; tooling specialist"],["w65","editor-core","timeline/edit operations; surge specialist"],["w66","video-engine","decode/render/compositing; surge specialist"],["w67","audio-engine","mixing/sync/mastering; surge specialist"],["w68","voiceover","TTS/provider failover; surge specialist"],["w69","captions","caption timing/accessibility; surge specialist"],["w70","export","codec/export pipelines; surge specialist"],["w71","editor-ux","controls/inspector/preview; surge specialist"],["w72","editor-qa","editor regression/media validation; surge specialist"]]);

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
    workers:WORKER_ASSIGNMENTS.map(([id,role,job])=>createPermanentWorker({id,role,job}))
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
