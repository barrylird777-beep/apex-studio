import crypto from "node:crypto";
const uid=(prefix="id")=>prefix+"-"+crypto.randomUUID();
const now=()=>new Date().toISOString();

const TASKS = Object.freeze([
  ["editor-core","Upgrade the all-in-one editor: multitrack timeline, trimming, snapping, ripple edits, keyframes, transitions, undo/redo."],
  ["video-engine","Upgrade video processing: proxies, hardware encoding, color transforms, effects, compositing, frame accuracy, render performance."],
  ["audio-engine","Upgrade audio: multitrack mixing, loudness, ducking, fades, time-stretching, cleanup, meters, synchronization."],
  ["captions","Upgrade captions/subtitles: styling, animation, timing, import/export, burn-in, accessibility."],
  ["export","Upgrade delivery: H.264/H.265/AV1, 4K/60, presets, bitrate control, batch exports, validation, recovery."],
  ["editor-ux","Upgrade editor interaction speed: keyboard workflows, selection, snapping, inspector controls, responsive previews, project recovery."],
  ["editor-qa","Continuously test editor operations, media edge cases, export correctness, performance regressions, and data integrity."],
  ["infrastructure","Monitor worker health, provider availability, queue latency, storage, and deployment reliability."],
  ["automation","Keep the overnight queue flowing: retries, deduplication, checkpoints, recovery, and worker balancing."],
  ["research","Build source-backed historical profiles for biblical figures; record primary/secondary sources and uncertainty."],
  ["genealogy","Build ancestry and kinship records from explicit textual evidence; flag disputed genealogies instead of guessing."],
  ["textual-traditions","Compare canon, translation, manuscript, and textual-tradition differences relevant to reference data."],
  ["world-knowledge","Build geographic, cultural, institutional, economic, and political reference context with provenance."],
  ["chronology","Normalize date ranges, reigns, periods, and relative chronology; preserve uncertainty ranges."],
  ["visual-direction","Build reusable director-reference knowledge for camera language, blocking, lighting, composition, continuity, and historical visual context."],
  ["audio","Build pronunciation, transliteration, prosody, naming, and sound-reference metadata."],
  ["publishing","Normalize knowledge packets, metadata, indexes, provenance, and retrieval-ready exports."],
  ["automation","Keep the overnight queue flowing: retries, deduplication, checkpoints, recovery, and worker balancing."],
  ["qa","Cross-check claims, provenance, contradictions, missing citations, and schema integrity before promotion."],
  ["infrastructure","Monitor worker health, provider availability, queue latency, storage, and deployment reliability."],
  ["editor-core","Upgrade the all-in-one editor: multitrack timeline, trimming, snapping, ripple edits, keyframes, transitions, and undo/redo."],
  ["video-engine","Upgrade video processing: proxies, hardware encoding, color transforms, effects, compositing, frame accuracy, and render performance."],
  ["audio-engine","Upgrade audio: multitrack mixing, loudness, ducking, fades, time-stretching, cleanup, meters, and synchronization."],
  ["captions","Upgrade captions/subtitles: styling, animation, timing, import/export, burn-in, and accessibility."],
  ["export","Upgrade delivery: H.264/H.265/AV1, 4K/60, presets, bitrate control, batch exports, validation, and recovery."],
  ["editor-ux","Upgrade editor interaction speed: keyboard workflows, selection, snapping, inspector controls, responsive previews, and project recovery."],
  ["editor-qa","Continuously test editor operations, media edge cases, export correctness, performance regressions, and data integrity." ]
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
