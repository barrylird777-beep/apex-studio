import crypto from "node:crypto";
import { GeminiMeshProvider } from "../core/mesh/gemini-mesh-provider.mjs";
import { MultiAiCoordinator } from "../core/mesh/multi-ai-coordinator.mjs";
import {
  claimNextWorkerTasks,
  completeWorkerTask,
  failWorkerTask,
  heartbeatWorkerTask
} from "../core/mesh/durable-worker-store.mjs";
import { ensurePopcornSchema, upsertPopcorns } from "../core/bible/popcorn-store.mjs";

const BATCH_SIZE = Math.max(5, Math.min(50, Number(process.env.APEX_POPCORN_BATCH_SIZE || 25)));
const CLAIM_SIZE = Math.max(1, Math.min(100, Number(process.env.APEX_POPCORN_CLAIM_SIZE || 100)));
const CONCURRENCY = Math.max(1, Math.min(200, Number(process.env.APEX_POPCORN_CONCURRENCY || 64)));
const IDLE_MS = Math.max(100, Number(process.env.APEX_POPCORN_IDLE_MS || 500));

function parseJson(text) {
  const raw = String(text || "").trim();
  const a = raw.indexOf("[");
  const b = raw.lastIndexOf("]");
  if (a < 0 || b < a) throw new Error("Popcorn AI returned no JSON array");
  return JSON.parse(raw.slice(a, b + 1));
}

function buildPrompt(verses) {
  return [
    "You are the Apex Bible Finder Crew.",
    "Analyze every supplied Scripture verse independently and identify movie-worthy excerpts called POPCORNS.",
    "Do not rewrite, embellish, or invent Scripture. The excerpt must remain exactly the supplied text.",
    "Return ONLY a JSON array with exactly one object per supplied verse.",
    "Each object keys: reference, excerpt, title, cinematicReason, characterMoment, visualMoment, dialoguePotential, conflictTension, emotionalBeat, productionPotential, popcornRank, confidence, tags.",
    "popcornRank is 0-100. confidence is 0-1.",
    "A popcorn is especially strong when the passage contains an event, confrontation, revelation, sacrifice, transformation, miracle, journey, danger, powerful dialogue, visual spectacle, or emotionally playable human moment.",
    "If a verse is not especially cinematic, still return it with popcornRank below 40.",
    JSON.stringify(verses)
  ].join("\n\n");
}

async function processTask(task, coordinator) {
  const verses = Array.isArray(task.payload?.verses) ? task.payload.verses.slice(0, BATCH_SIZE) : [];
  if (!verses.length) return { popcorns: 0 };
  const result = await coordinator.run({
    task: buildPrompt(verses),
    providers: ["gemini"],
    system: "Return strict JSON only. Scripture is canonical source material; never fabricate quotation text."
  });
  if (!result.ok) throw new Error("No AI provider completed popcorn analysis");
  const text = result.synthesis?.text || result.results.find(x => x.ok)?.text;
  const analyzed = parseJson(text);
  if (analyzed.length !== verses.length) throw new Error("Popcorn output count does not match input verse count");

  const rows = analyzed.map((x, i) => ({
    id: crypto.randomUUID(),
    collectionId: task.payload.collectionId || "default",
    reference: String(x.reference || verses[i].reference),
    excerpt: String(x.excerpt || verses[i].text || ""),
    title: x.title || null,
    cinematicReason: String(x.cinematicReason || ""),
    characterMoment: x.characterMoment || null,
    visualMoment: x.visualMoment || null,
    dialoguePotential: x.dialoguePotential || null,
    conflictTension: x.conflictTension || null,
    emotionalBeat: x.emotionalBeat || null,
    productionPotential: x.productionPotential || null,
    popcornRank: Number(x.popcornRank) || 0,
    confidence: Number(x.confidence) || 0,
    verificationStatus: "ai-review",
    canonicalSource: verses[i].source || null,
    sourceMetadata: { source: verses[i].source || null, verseId: verses[i].id || null },
    provenance: { crew: "bible-finder", task: "POPCORN_DISCOVERY", model: result.synthesis?.model || result.results.find(y => y.ok)?.model || null },
    tags: Array.isArray(x.tags) ? x.tags : []
  }));
  const saved = await upsertPopcorns(rows);
  return { popcorns: saved.length };
}

export async function enqueuePopcornVerseBatch({ verses, collectionId = "default", workerId = "popcorn-dispatcher" } = {}) {
  const { enqueueWorkerTask } = await import("../core/mesh/durable-worker-store.mjs");
  const items = Array.isArray(verses) ? verses : [];
  const ids = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const key = crypto.createHash("sha256").update(JSON.stringify([collectionId, batch])).digest("hex");
    const id = crypto.randomUUID();
    await enqueueWorkerTask({
      id, workerId, role: "bible-finder-popcorn", task: "BIBLE_POPCORN_DISCOVERY",
      payload: { collectionId, verses: batch, idempotencyKey: key }, maxAttempts: 5
    });
    ids.push(id);
  }
  return ids;
}

export function startPopcornWorker({ coordinator = new MultiAiCoordinator({ providers: { gemini: new GeminiMeshProvider() } }) } = {}) {
  let stopped = false;
  const running = new Set();

  async function launch(task) {
    const lease = 120000;
    const workerId = "popcorn-" + (process.env.HOSTNAME || "local");
    const heartbeat = setInterval(() => {
      void heartbeatWorkerTask(task.id, lease, task.lease_token).catch(() => {});
    }, 30000);
    try {
      const result = await processTask(task, coordinator);
      await completeWorkerTask(task.id, result, task.lease_token);
    } catch (error) {
      await failWorkerTask(task.id, error, task.lease_token);
    } finally {
      clearInterval(heartbeat);
      running.delete(task.id);
    }
  }

  async function pump() {
    if (stopped) return;
    try {
      await ensurePopcornSchema();
      const capacity = Math.max(0, CONCURRENCY - running.size);
      if (capacity > 0) {
        const tasks = await claimNextWorkerTasks(Math.min(CLAIM_SIZE, capacity), 120000, "BIBLE_POPCORN_DISCOVERY");
        for (const task of tasks) {
          running.add(task.id);
          void launch(task);
        }
      }
    } catch (error) {
      console.error("[popcorn-worker]", error?.message || error);
    } finally {
      if (!stopped) setTimeout(pump, running.size ? 25 : IDLE_MS).unref?.();
    }
  }

  void pump();
  return {
    stop() { stopped = true; },
    status() { return { running: running.size, concurrency: CONCURRENCY, batchSize: BATCH_SIZE }; }
  };
}
