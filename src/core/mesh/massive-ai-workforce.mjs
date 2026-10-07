import crypto from "node:crypto";

const now = () => new Date().toISOString();

const DEFAULT_MISSION = "Continuously improve Apex without inventing capabilities or claiming unverified work.";
const DEFAULT_TASKS = Object.freeze({
  "editor-core": "Inspect editor operations and identify one concrete correctness improvement.",
  "video-engine": "Inspect video decode/render/compositing and identify one concrete correctness or performance improvement.",
  "audio-engine": "Inspect audio mixing, synchronization, mastering, and identify one concrete improvement.",
  "voiceover": "Inspect voice generation/provider failover and identify one concrete reliability improvement.",
  "captions": "Inspect captions, timing, accessibility, and identify one concrete improvement.",
  "export": "Inspect export/codec pipeline and identify one concrete reliability improvement.",
  "editor-ux": "Inspect editor interaction and identify one concrete mobile or usability improvement.",
  "editor-qa": "Find one reproducible editor/media regression and define its smallest test.",
  "media-ingest": "Inspect ingest/probing/asset validation and identify one concrete failure mode.",
  "project-storage": "Inspect project persistence/recovery and identify one concrete integrity improvement.",
  "render-cache": "Inspect render-cache correctness/invalidation and identify one concrete improvement.",
  "performance": "Find one measurable CPU, memory, latency, queue, render, or network bottleneck.",
  "infrastructure": "Inspect workers, queues, deployment, and runtime health for one concrete defect.",
  "automation": "Inspect scheduling/retries/checkpoints and identify one concrete reliability improvement.",
  "observability": "Inspect health, logs, metrics, and failure evidence for one concrete gap.",
  "knowledge-research": "Inspect research ingestion and provenance for one evidence-quality improvement.",
  "genealogy": "Inspect ancestry/kinship evidence handling for one uncertainty or provenance improvement.",
  "textual-traditions": "Inspect textual-source handling and identify one provenance or accuracy improvement.",
  "world-knowledge": "Inspect reference-data handling and identify one evidence-backed improvement.",
  "chronology": "Inspect date/range/uncertainty handling and identify one consistency improvement.",
  "visual-direction": "Inspect visual continuity/camera/lighting metadata and identify one production improvement.",
  "audio-reference": "Inspect pronunciation/transliteration/audio metadata and identify one correctness improvement.",
  "publishing": "Inspect packaging/metadata/provenance exports and identify one retrieval improvement.",
  "accessibility": "Inspect accessibility semantics, captions, contrast, and mobile controls for one concrete gap.",
  "release-qa": "Act as release QA and identify one reproducible blocker or missing acceptance test."
});

export function createMassiveAiWorkforce({
  fleet,
  crew,
  mission = DEFAULT_MISSION,
  maxActive = Number(process.env.APEX_MASSIVE_AI_ACTIVE || 64),
  batchSize = Number(process.env.APEX_MASSIVE_AI_BATCH || 128)
} = {}) {
  if (!fleet || !Array.isArray(fleet.workers)) throw new TypeError("worker fleet is required");
  if (!crew || typeof crew.enqueue !== "function") throw new TypeError("AI crew is required");

  const activeLimit = Math.max(1, Number(maxActive) || 64);
  const configuredBatch = Math.max(1, Number(batchSize) || 128);
  const jobs = new Map();
  let running = 0;
  let dispatchSequence = 0;

  function taskFor(worker, context = {}) {
    const role = String(worker?.role || "general");
    const base = DEFAULT_TASKS[role] || "Inspect the assigned Apex surface for one concrete defect, improvement, or missing test.";
    const scope = String(context.scope || "").trim();
    const requirement = String(context.requirement || "").trim();
    return [
      base,
      `Worker role: ${role}.`,
      `Worker id: ${String(worker?.id || "unknown")}.`,
      `Mission: ${mission}`,
      scope ? `Scope: ${scope}` : "",
      requirement ? `Acceptance requirement: ${requirement}` : "",
      "Return evidence, the smallest concrete change, and a test or verification method. Do not claim execution unless evidence exists."
    ].filter(Boolean).join(" ");
  }

  function createJob(worker, context) {
    const id = "massive_" + crypto.randomUUID();
    const job = {
      id,
      workerId: String(worker.id),
      role: String(worker.role || "general"),
      status: "queued",
      task: taskFor(worker, context),
      createdAt: now(),
      startedAt: null,
      completedAt: null,
      result: null,
      error: null
    };
    jobs.set(id, job);
    return job;
  }

  async function run(job, context = {}) {
    running += 1;
    job.status = "running";
    job.startedAt = now();
    try {
      const result = await crew.enqueue({
        role: job.role,
        task: job.task,
        context: {
          mission,
          workerId: job.workerId,
          role: job.role,
          ...context
        }
      });
      job.status = "dispatched";
      job.result = result;
      job.completedAt = now();
      return job;
    } catch (error) {
      job.status = "failed";
      job.error = String(error?.message || error);
      job.completedAt = now();
      return job;
    } finally {
      running = Math.max(0, running - 1);
    }
  }

  async function dispatchWorkers({ workers = fleet.workers, context = {}, limit = configuredBatch } = {}) {
    const candidates = Array.isArray(workers) ? workers : [];
    const count = Math.min(Math.max(0, Number(limit) || configuredBatch), candidates.length);
    const selected = candidates.slice(0, count);
    const created = selected.map(worker => createJob(worker, context));
    const results = [];
    for (let index = 0; index < created.length; index += activeLimit) {
      const slice = created.slice(index, index + activeLimit);
      results.push(...await Promise.all(slice.map(job => run(job, context))));
    }
    return results;
  }

  function status() {
    const all = [...jobs.values()];
    return {
      mission,
      activeLimit,
      configuredBatch,
      fleetWorkers: fleet.workers.length,
      running,
      totalDispatched: all.length,
      queued: all.filter(j => j.status === "queued").length,
      runningJobs: all.filter(j => j.status === "running").length,
      dispatched: all.filter(j => j.status === "dispatched").length,
      failed: all.filter(j => j.status === "failed").length,
      jobs: all.slice(-100)
    };
  }

  return { taskFor, dispatchWorkers, status };
}

export { DEFAULT_TASKS };
