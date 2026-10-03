import { uid, now } from "./id.mjs";

const TASKS = Object.freeze([
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
  ["infrastructure","Monitor worker health, provider availability, queue latency, storage, and deployment reliability."]
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
      priority:index<6?100:90,
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
