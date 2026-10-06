import crypto from "node:crypto";
import { GeminiMeshProvider } from "./gemini-mesh-provider.mjs";
import { ClaudeMeshProvider } from "./claude-mesh-provider.mjs";
import { enqueueWorkerTask, deferWorkerTask } from "./durable-worker-store.mjs";
import { executeCrewInference } from "./crew-inference-worker.mjs";
import MediaRenderHandler from "../../workers/handlers/media-render-handler.mjs";

function json(value) {
  return JSON.stringify(value ?? {});
}

function episodePayload(task) {
  const p = task?.payload && typeof task.payload === "object" ? task.payload : {};
  const episodeId = String(p.episodeId || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(episodeId)) throw new Error("Episode task requires a valid episodeId");
  return { ...p, episodeId };
}

async function saveContext(pool, episodeId, contextType, rawData) {
  await pool.query(
    `INSERT INTO apex_episode_context (episode_id, context_type, raw_data)
     VALUES ($1,$2,$3::jsonb)
     ON CONFLICT (episode_id, context_type)
     DO UPDATE SET raw_data=EXCLUDED.raw_data, updated_at=NOW()`,
    [episodeId, contextType, json(rawData)]
  );
}

async function graphExpansion({ pool, task }) {
  const p = episodePayload(task);
  const r = await pool.query(
    `SELECT id, reference, book, chapter, verse_start, verse_end, text, canonical, metadata
       FROM bible_passages
      WHERE book=$1 AND chapter=$2
        AND ($3='full' OR (verse_start <= split_part($3,'-',1)::int AND verse_end >= split_part($3,'-',1)::int)
          OR ($3 LIKE '%-%' AND verse_start <= split_part($3,'-',2)::int AND verse_end >= split_part($3,'-',1)::int))
      ORDER BY verse_start
      LIMIT 250`,
    [String(p.book), Number(p.chapter), String(p.verses || "full")]
  );

  const passages = r.rows;
  const context = {
    episodeId: p.episodeId,
    expansionType: String(p.expansionType || p.type || "general"),
    source: "bible_passages",
    passageCount: passages.length,
    passages
  };
  await saveContext(pool, p.episodeId, `graph-${String(p.expansionType || p.type || "general")}`, context);
  return context;
}

async function generateScript({ pool, task }) {
  const p = episodePayload(task);
  const deps = await pool.query(
    `SELECT id, role, task, status, result, payload
       FROM apex_worker_tasks
      WHERE payload->>'episodeId'=$1
        AND role='graph-expansion'
        AND status IN ('queued','running','completed','failed')
      ORDER BY created_at`,
    [p.episodeId]
  );
  const graphJobs = deps.rows.filter(row => row.status === "completed");
  const failedGraphJobs = deps.rows.filter(row => row.status === "failed");
  if (failedGraphJobs.length) throw new Error(`Graph expansion dependency failed: ${failedGraphJobs.map(row => row.id).join(",")}`);
  if (graphJobs.length < 2) {
    const ok = await deferWorkerTask(
      task.id,
      1500,
      `Waiting for graph expansion dependencies: ${graphJobs.length}/2 complete`,
      task.lease_token
    );
    if (!ok) throw new Error("SCRIPT_DEFER_FENCED");
    return { deferred: true, dependencies: graphJobs.length };
  }

  const contexts = await pool.query(
    `SELECT context_type, raw_data
       FROM apex_episode_context
      WHERE episode_id=$1 AND context_type IN ('graph-theological','graph-historical')`,
    [p.episodeId]
  );
  const prompt = [
    "Create a production-ready Bible episode script.",
    `Book: ${p.book}; chapter: ${p.chapter}; verses: ${p.verses || "full"}.`,
    "Requirements: compelling first 30 seconds, scene-by-scene visual direction, dialogue/narration, audio cues, scripture provenance, and no invented citations.",
    "Research context:",
    json(contexts.rows)
  ].join("\n\n");

  const gemini = new GeminiMeshProvider();
  let script;
  try {
    script = await gemini.generate(prompt, { system: "You are Apex Studio's Bible episode script engine. Preserve scripture provenance and clearly label creative reconstruction." });
  } catch (geminiError) {
    const claude = new ClaudeMeshProvider();
    script = await claude.generate(prompt, { system: "You are Apex Studio's Bible episode script engine. Preserve scripture provenance and clearly label creative reconstruction." });
  }

  await saveContext(pool, p.episodeId, "script", {
    episodeId: p.episodeId,
    script,
    generatedAt: new Date().toISOString(),
    dependencies: graphJobs.map(row => row.id)
  });

  const renderKey = `episode:${p.episodeId}:render`;
  const renderId = crypto.randomUUID();
  await enqueueWorkerTask({
    id: renderId,
    workerId: "episode-pipeline",
    role: "episode-render",
    task: "episode-render",
    payload: { episodeId: p.episodeId, book: p.book, chapter: Number(p.chapter), verses: p.verses || "full", stage: 3, dependsOn: task.id, traceId: task.trace_id || p.traceId || null },
    maxAttempts: 5,
    dedupeKey: renderKey,
    traceId: task.trace_id || p.traceId || null
  });
  await pool.query(
    "UPDATE apex_episode_pipelines SET status='scripted', updated_at=NOW() WHERE id=$1",
    [p.episodeId]
  );
  return { episodeId: p.episodeId, scriptLength: String(script).length, renderJobId: renderId };
}

async function renderPlan({ pool, task, mediaRenderHandler }) {
  const p = episodePayload(task);
  const r = await pool.query(
    "SELECT raw_data FROM apex_episode_context WHERE episode_id=$1 AND context_type='script'",
    [p.episodeId]
  );
  if (!r.rows[0]) {
    const ok = await deferWorkerTask(task.id, 2000, "Waiting for generated script", task.lease_token);
    if (!ok) throw new Error("RENDER_DEFER_FENCED");
    return { deferred: true };
  }
  const script = String(r.rows[0].raw_data?.script || "");
  const plan = {
    episodeId: p.episodeId,
    status: "planned",
    sceneCount: Math.max(1, (script.match(/(?:^|\n)\s*(?:scene|##)\b/gi) || []).length),
    scriptLength: script.length,
    plannedAt: new Date().toISOString()
  };
  await saveContext(pool, p.episodeId, "render-plan", plan);
  const media = await mediaRenderHandler.process({ episodeId: p.episodeId, book: p.book, chapter: Number(p.chapter), durationSeconds: Number(p.durationSeconds) || undefined });
  await pool.query(
    "UPDATE apex_episode_pipelines SET status='rendered', updated_at=NOW() WHERE id=$1",
    [p.episodeId]
  );
  return { ...plan, media };
}

async function aiCrewEvaluate({ task }) {
  const payload = task?.payload && typeof task.payload === "object" ? task.payload : {};
  const prompt = String(payload.prompt || "").trim();
  const system = String(payload.system || "").trim();
  if (!prompt) throw new Error("AI crew task requires a prompt");
  const result = await executeCrewInference(prompt, system || undefined, { role: payload.crewRole || "general" });
  return {
    type: "ai-crew-result",
    crewJobId: payload.crewJobId || task.id,
    role: payload.crewRole || "general",
    provider: result.provider,
    text: result.text,
    failures: result.failures || [],
    completedAt: new Date().toISOString()
  };
}

async function rfAnomalyEvaluate({ task }) {
  const payload = task?.payload && typeof task.payload === "object" ? task.payload : {};
  const bssid = String(payload.bssid || "").trim();
  const embedding = payload.embedding;

  if (!bssid) throw new Error("RF anomaly task requires bssid");
  if (!Array.isArray(embedding) || embedding.length !== 1536) {
    throw new Error("RF anomaly task requires a 1536-dimensional embedding");
  }
  if (!embedding.every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new Error("RF anomaly task embedding contains invalid values");
  }

  const { processRfAnomalyTrigger } = await import("../../rf-ai-bridge.mjs");
  return processRfAnomalyTrigger(bssid, embedding);
}

export function createEpisodeJobDispatcher({ pool }) {
  if (!pool) throw new TypeError("Episode dispatcher requires PostgreSQL");
  const mediaRenderHandler = new MediaRenderHandler(pool);
  return async function dispatchEpisodeJob(task) {
    switch (String(task?.role || task?.task || "")) {
      case "graph-expansion":
        return graphExpansion({ pool, task });
      case "episode-script-generation":
        return generateScript({ pool, task });
      case "episode-render":
        return renderPlan({ pool, task, mediaRenderHandler });
      case "rf-anomaly-evaluate":
        return rfAnomalyEvaluate({ task });
      case "ai-crew":
        return aiCrewEvaluate({ task });
      default:
        return null;
    }
  };
}
