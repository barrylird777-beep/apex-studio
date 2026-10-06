import { APEX_LIMITS } from "./apex-limits.mjs";
import crypto from "node:crypto";
import { durableWorkerEnabled, enqueueWorkerTask } from "./durable-worker-store.mjs";

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

export function createAiCrewEngine({ dispatch, roles=Object.keys(ROLE_PROMPTS), concurrency=APEX_LIMITS.AI_CREW.IN_MEMORY_CONCURRENCY }={}) {
  if(typeof dispatch!=="function") throw new TypeError("AI crew dispatch function is required");
  const safeConcurrency=Math.max(1,Math.min(APEX_LIMITS.AI_CREW.MAX_CONCURRENCY_BOUND,Number(concurrency)||APEX_LIMITS.AI_CREW.IN_MEMORY_CONCURRENCY));
  const durable=durableWorkerEnabled();
  const maxQueue=Math.max(safeConcurrency,Math.min(APEX_LIMITS.AI_CREW.MAX_QUEUE_CAPACITY,Number(process.env.APEX_AI_CREW_MAX_QUEUE)||APEX_LIMITS.AI_CREW.QUEUE_CAPACITY));
  const recentLimit=Math.max(100,Math.min(1000,Number(process.env.APEX_AI_CREW_RECENT_LIMIT)||500));
  let roleCursor=0;
  let sequence=0;
  const queue=[];
  const active=new Map();
  const dedupe=new Map();
  const completed=[];
  const failed=[];
  let running=true;

  function enqueue(input={}) {
    const role=String(input.role||roles[roleCursor++%Math.max(1,roles.length)]||"qa");
    const task=String(input.task||ROLE_PROMPTS[role]||"Audit and improve the assigned Apex subsystem.");
    if(queue.length>=maxQueue) throw new Error(`AI crew queue capacity exceeded (${maxQueue})`);
    const id=input.id||crypto.randomUUID();
    const priorityMap={critical:4,high:3,normal:2,low:1};
    const priority=String(input.priority||"normal").toLowerCase();
    const context=input.context&&typeof input.context==="object"?input.context:{};
    const dedupeKey=String(input.dedupeKey||[role,task,JSON.stringify(context)].join("|"));
    const existing=dedupe.get(dedupeKey);
    if(existing&&["queued","running"].includes(existing.status)) return {...existing,deduped:true};
    const item={id,sequence:++sequence,role,task,priority,priorityWeight:priorityMap[priority]||2,context,createdAt:now(),status:"queued",dedupeKey,attempts:0};
    dedupe.set(dedupeKey,item);

    if (durable) {
      const prompt = [
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
        Object.keys(item.context).length ? "CONTEXT:\\n"+JSON.stringify(item.context) : ""
      ].filter(Boolean).join("\\n");
      void enqueueWorkerTask({
        id: item.id,
        workerId: "ai-crew",
        role: "ai-crew",
        task: item.task,
        maxAttempts: Math.max(1, Math.min(5, Number(item.context?.maxAttempts || 3))),
        dedupeKey,
        traceId: item.context?.traceId || null,
        payload: {
          type: "ai-crew",
          crewJobId: item.id,
          crewRole: item.role,
          prompt,
          system: [
            "You are an autonomous Apex specialist in the "+item.role+" lane.",
            "Produce concrete, technically actionable work, not generic advice.",
            "Do not invent repository facts, sources, tests, files, APIs, or capabilities.",
            "Identify the highest-impact root defect first and give the smallest safe fix.",
            "Separate verified evidence, inference, and unknowns.",
            "Prefer deterministic outputs, idempotency, and measurable acceptance criteria.",
            "Return implementation-ready output: defect, root cause, change, validation, next attack."
          ].join(" ")
        }
      }).then(result => {
        item.durableId=result.id;
        item.status="queued";
      }).catch(error => {
        item.status="failed";
        item.error=String(error?.message || error);
        failed.push(item);
        if(failed.length>recentLimit) failed.shift();
        if(dedupe.get(item.dedupeKey)?.id===item.id) dedupe.delete(item.dedupeKey);
      });
      return {...item,durable:true};
    }

    queue.push(item);
    queue.sort((a,b)=>b.priorityWeight-a.priorityWeight||a.sequence-b.sequence);
    pump();
    return {...item,durable:false};
  }

  async function execute(item) {
    item.status="running";
    item.startedAt=now();
    active.set(item.id,item);
    try {
      let result;
      let lastError;
      const maxAttempts=Math.max(1,Math.min(3,Number(item.context?.maxAttempts||process.env.APEX_AI_CREW_MAX_ATTEMPTS)||2));
      for(let attempt=1;attempt<=maxAttempts;attempt++) {
        item.attempts=attempt;
        try {
          result=await dispatch({
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
        system: [
            "You are an autonomous Apex specialist in the "+item.role+" lane.",
            "Produce concrete, technically actionable work, not generic advice.",
            "Do not invent repository facts, sources, tests, files, APIs, or capabilities.",
            "Identify the highest-impact root defect first and give the smallest safe fix.",
            "Separate verified evidence, inference, and unknowns.",
            "Prefer parallelizable work, deterministic outputs, idempotency, and measurable acceptance criteria.",
            "Return implementation-ready output: defect, root cause, change, validation, next attack."
          ].join(" ")
          });
          break;
        } catch(error) {
          lastError=error;
          if(attempt<maxAttempts) await new Promise(resolve=>setTimeout(resolve,Math.min(2000,150*Math.pow(2,attempt-1))));
        }
      }
      if(result===undefined) throw lastError||new Error("AI crew dispatch failed");
      item.status="completed";
      item.result=result;
      item.completedAt=now();
      completed.push(item);
      if(completed.length>recentLimit) completed.shift();
    } catch(error) {
      item.status="failed";
      item.error=String(error?.message||error);
      item.completedAt=now();
      failed.push(item);
      if(failed.length>recentLimit) failed.shift();
    } finally {
      active.delete(item.id);
      if(dedupe.get(item.dedupeKey)?.id===item.id) dedupe.delete(item.dedupeKey);
      pump();
    }
  }

  function pump() {
    if(!running) return;
    while(active.size<safeConcurrency && queue.length) void execute(queue.shift());
  }

  function burst(count=32, context={}) {
    const n=Math.max(1,Math.min(Math.max(1,maxQueue-queue.length),Number(count)||32));
    const batchId=String(context?.batchId||crypto.randomUUID());
    const jobs=Array.from({length:n},(_,i)=>{ const role=roles[(roleCursor+i)%roles.length]; return enqueue({role,context:{...context,batchId},priority:context?.priority,dedupeKey:[batchId,i].join("|")}); });
    roleCursor=(roleCursor+n)%Math.max(1,roles.length);
    return jobs;
  }

  function status() {
    return {
      running,
      queueCapacity:maxQueue,
      queueUtilization:queue.length/maxQueue,
      throughput:{completed:completed.length,failed:failed.length},
      concurrency:safeConcurrency,
      durable,
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
