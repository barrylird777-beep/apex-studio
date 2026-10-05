import crypto from "node:crypto";

const ROLE_PROMPTS = Object.freeze({
  "knowledge-research":"Research a Bible-related topic using available source-backed context. Separate established facts, uncertainty, and claims requiring verification. Preserve provenance.",
  "genealogy":"Analyze biblical genealogy, kinship, lineage, and family relationships. Distinguish explicit text from inference and flag uncertainty.",
  "textual-traditions":"Analyze canon, translations, manuscripts, textual variants, and textual traditions. Never collapse distinct witnesses into one claim.",
  "world-knowledge":"Analyze geography, culture, institutions, material context, and historical setting relevant to the assigned Bible topic.",
  "chronology":"Build or audit chronology and date ranges. Identify conflicts, assumptions, and confidence.",
  "visual-direction":"Turn the assigned biblical material into cinematic visual direction: composition, camera, lighting, environment, continuity, and historically informed visual cues.",
  "audio-reference":"Develop pronunciation, transliteration, prosody, naming, sound-design, and audio-reference guidance while flagging uncertain pronunciations.",
  "publishing":"Prepare structured metadata, indexing terms, provenance fields, and retrieval-ready packaging for the assigned material.",
  "automation":"Find queue, retry, deduplication, checkpoint, recovery, and throughput improvements for the assigned Apex subsystem.",
  "qa":"Audit the assigned result for factual support, provenance, consistency, failure modes, and release blockers.",
  "infrastructure":"Audit workers, queues, providers, concurrency, leases, deployment health, and recovery for the assigned Apex subsystem.",
  "editor-core":"Improve timeline editing, snapping, trimming, keyframes, transitions, undo/redo, or editor correctness.",
  "video-engine":"Improve decode, proxies, compositing, effects, frame accuracy, rendering, and video reliability.",
  "audio-engine":"Improve mixing, loudness, ducking, cleanup, time-stretch, synchronization, and mastering.",
  "captions":"Improve subtitle timing, styling, animation, accessibility, and caption import/export.",
  "export":"Improve codec/export pipelines, presets, bitrate, batch export, recovery, and validation.",
  "editor-ux":"Improve selection, keyboard workflows, inspector, preview, snapping, and recovery.",
  "editor-qa":"Find editor/media edge cases and design concrete regression tests.",
  "voiceover":"Improve voice catalog, synthesis, pronunciation, long-form stitching, and provider failover.",
  "media-ingest":"Improve upload, probing, thumbnails, metadata, proxies, and asset validation.",
  "project-storage":"Improve autosave, versioning, snapshots, recovery, and storage integrity.",
  "render-cache":"Improve incremental rendering, cache reuse, invalidation, and preview acceleration.",
  "performance":"Find measurable latency, memory, CPU/GPU, or throughput bottlenecks and propose concrete fixes.",
  "observability":"Improve metrics, health checks, logs, failure detection, and operational visibility.",
  "accessibility":"Audit captions, contrast, keyboard access, audio descriptions, and export accessibility.",
  "release-qa":"Audit integration, smoke tests, deployment readiness, and rollback risks."
});

const now=()=>new Date().toISOString();

export function createAiCrewEngine({ dispatch, roles=Object.keys(ROLE_PROMPTS), concurrency=16 }={}) {
  if(typeof dispatch!=="function") throw new TypeError("AI crew dispatch function is required");
  const safeConcurrency=Math.max(1,Math.min(128,Number(concurrency)||16));
  const queue=[];
  const active=new Map();
  const completed=[];
  const failed=[];
  let running=true;

  function enqueue(input={}) {
    const role=String(input.role||roles[Math.floor(Math.random()*roles.length)]||"qa");
    const task=String(input.task||ROLE_PROMPTS[role]||"Audit and improve the assigned Apex subsystem.");
    const id=input.id||crypto.randomUUID();
    const item={id,role,task,context:input.context&&typeof input.context==="object"?input.context:{},createdAt:now(),status:"queued"};
    queue.push(item);
    pump();
    return {...item};
  }

  async function execute(item) {
    item.status="running";
    item.startedAt=now();
    active.set(item.id,item);
    try {
      const result=await dispatch({
        type:"inference",
        prompt: [
          "APEX AI CREW ASSIGNMENT",
          "ROLE: "+item.role,
          "MISSION: "+item.task,
          "EXECUTION RULES:",
          "1. Produce concrete, technically actionable work.",
          "2. Do not invent repository facts, sources, tests, files, or capabilities.",
          "3. Identify defects before proposing changes.",
          "4. Prefer root-cause fixes over cosmetic changes.",
          "5. Preserve provenance and distinguish verified facts from inference.",
          "6. Return implementation-ready output with acceptance criteria and validation steps.",
          item.context && Object.keys(item.context).length ? "CONTEXT:\n"+JSON.stringify(item.context) : ""
        ].filter(Boolean).join("\n"),
        system: "You are an autonomous Apex specialist. Work as a member of a coordinated engineering and Bible-production crew. Be precise, evidence-driven, and implementation-oriented."
      });
      item.status="completed";
      item.result=result;
      item.completedAt=now();
      completed.push(item);
      if(completed.length>200) completed.shift();
    } catch(error) {
      item.status="failed";
      item.error=String(error?.message||error);
      item.completedAt=now();
      failed.push(item);
      if(failed.length>200) failed.shift();
    } finally {
      active.delete(item.id);
      pump();
    }
  }

  function pump() {
    if(!running) return;
    while(active.size<safeConcurrency && queue.length) void execute(queue.shift());
  }

  function burst(count=32, context={}) {
    const n=Math.max(1,Math.min(500,Number(count)||32));
    return Array.from({length:n},(_,i)=>enqueue({role:roles[i%roles.length],context}));
  }

  function status() {
    return {
      running,
      concurrency:safeConcurrency,
      queued:queue.length,
      active:active.size,
      completed:completed.length,
      failed:failed.length,
      roles:[...roles],
      recentCompleted:completed.slice(-20).map(({id,role,task,status,createdAt,completedAt})=>({id,role,task,status,createdAt,completedAt})),
      recentFailed:failed.slice(-20).map(({id,role,task,error,createdAt,completedAt})=>({id,role,task,error,createdAt,completedAt}))
    };
  }

  return {
    enqueue, burst, status,
    stop(){running=false;return status();},
    start(){running=true;pump();return status();}
  };
}

export { ROLE_PROMPTS };
