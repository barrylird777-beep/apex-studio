import crypto from "node:crypto";
const uid=(prefix="id")=>prefix+"-"+crypto.randomUUID();
const now=()=>new Date().toISOString();

const TASKS = Object.freeze([
  ["editor-core","Continuously improve multitrack editing, trimming, snapping, ripple edits, keyframes, transitions, and undo/redo."],
  ["video-engine","Continuously improve decode, proxies, compositing, color, effects, frame accuracy, and render performance."],
  ["audio-engine","Continuously improve mixing, loudness, ducking, fades, cleanup, time-stretching, meters, and synchronization."],
  ["captions","Continuously improve subtitle timing, styling, animation, import/export, burn-in, and accessibility."],
  ["export","Continuously improve H.264/H.265/AV1, 4K/60, presets, bitrate control, batch exports, validation, and recovery."],
  ["editor-ux","Continuously improve keyboard workflows, selection, snapping, inspector controls, preview responsiveness, and recovery."],
  ["editor-qa","Continuously test editor operations, media edge cases, exports, regressions, and data integrity."],
  ["media-ingest","Continuously improve uploads, probing, thumbnails, metadata, proxies, and asset validation."],
  ["project-storage","Continuously improve autosave, versioning, snapshots, recovery, and storage integrity."],
  ["render-cache","Continuously improve incremental renders, cache reuse, invalidation, and preview acceleration."],
  ["performance","Continuously profile latency, memory, CPU/GPU utilization, and bottlenecks."],
  ["infrastructure","Continuously improve workers, queues, provider failover, deployment health, and scaling."],
  ["automation","Continuously improve scheduling, retries, deduplication, checkpoints, recovery, and balancing."],
  ["observability","Continuously improve metrics, health checks, logs, failure detection, and telemetry."],
  ["release-qa","Continuously validate integration, smoke tests, deployment readiness, and rollback safety."],
  ["accessibility","Continuously validate keyboard access, captions, contrast, audio descriptions, and exports."],
  ["voiceover","Continuously improve voice catalogs, synthesis routing, pronunciation, stitching, and provider failover."],
  ["audio-reference","Maintain source-backed pronunciation, transliteration, prosody, and sound-reference metadata."],
  ["publishing","Maintain metadata, indexes, provenance, packaging, and retrieval-ready exports."],
  ["knowledge-research","Maintain source-backed historical/reference research with provenance and uncertainty."],
  ["genealogy","Maintain explicit textual ancestry and kinship evidence with uncertainty; never infer unsupported relationships."],
  ["textual-traditions","Maintain canon, translation, manuscript, textual-variant, and provenance reference data."],
  ["world-knowledge","Maintain geography, chronology, cultures, institutions, and reference data with provenance."],
  ["chronology","Normalize date ranges, periods, relative chronology, and uncertainty."],
  ["visual-direction","Maintain camera, lighting, composition, continuity, and historical visual-reference metadata."],
  ["security","Continuously audit dependencies, input boundaries, secrets handling, and safe operational defaults."],
  ["compatibility","Continuously validate supported Node/runtime, media formats, browsers, and deployment environments."]
]);

export function createOvernightKnowledgePlan({hours=10}={}) {
  const durationHours=Math.max(1,Number(hours)||10);
  const createdAt=now();
  return {
    id:uid("overnight"),
    createdAt,
    durationHours,
    status:"queued",
    rules:{
      noStoryCreation:true,
      noNarrativeDevelopment:true,
      requireProvenance:true,
      preserveUncertainty:true,
      doNotInventFacts:true
    },
    tasks:TASKS.map(([role,objective],index)=>({
      id:uid("knowledge-task"),
      role,
      objective,
      priority:index<11?100:90,
      status:"queued",
      createdAt
    }))
  };
}

export function nextKnowledgeTasks(plan,limit=4) {
  return (plan?.tasks??[]).filter(t=>t.status==="queued").slice(0,Math.max(1,Number(limit)||1));
}

export function markKnowledgeTask(plan,id,status="running",result=null) {
  return {
    ...plan,
    tasks:(plan.tasks??[]).map(task=>task.id===id
      ? {...task,status,result,updatedAt:now()}
      : task)
  };
}

export function auditOvernightPlan(plan={}) {
  const tasks=Array.isArray(plan.tasks)?plan.tasks:[];
  return {
    total:tasks.length,
    queued:tasks.filter(t=>t.status==="queued").length,
    running:tasks.filter(t=>t.status==="running").length,
    completed:tasks.filter(t=>t.status==="completed").length,
    failed:tasks.filter(t=>t.status==="failed").length,
    storyWork:tasks.filter(t=>/story|narrative|character|scene/i.test(String(t.objective))).length
  };
}

export default createOvernightKnowledgePlan;
