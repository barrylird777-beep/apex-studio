import { APEX_WORKERS, getWorker } from "./apex-2000-worker-fabric.mjs";
import { apexPureStore } from "../core/apex-pure-store.mjs";

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

/**
 * Bridges permanent logical worker assignments into the Pure-WAL durable queue.
 * This enqueues work; it does not claim that 2,000 processes or AI models are running.
 */
export function createApexWorkerDispatcher({ store = apexPureStore } = {}) {
  if (!store || typeof store.enqueue !== "function" || typeof store.jobs !== "function") {
    throw new TypeError("a durable store with enqueue() and jobs() is required");
  }

  async function enqueueWorker(workerId, { context = {} } = {}) {
    const worker = getWorker(workerId);
    if (!worker) throw new Error(`unknown fixed APEX worker: ${workerId}`);

    const taskId = `apex-fixed-task:${worker.id}:${worker.task}`;
    // Treat completed/dead jobs as deduplicated too: fixed assignments must not
    // be silently recreated just because their previous execution finished.
    const existing = store.jobs().find(job => job.dedupeKey === taskId || job.id === taskId);
    if (existing) {
      return {
        worker: { ...worker },
        jobId: String(existing.id),
        duplicate: true,
        durable: true,
        status: existing.status
      };
    }

    const payload = {
      _apex_worker: { id: worker.id, role: worker.role, assignedTask: worker.task },
      assignedTask: worker.task,
      context: clone(context),
      requestedAt: new Date().toISOString()
    };
    const result = await store.enqueue({
      id: taskId,
      type: "apex.worker.assigned-task",
      payload,
      dedupeKey: taskId
    });
    return {
      worker: { ...worker },
      jobId: String(result.id),
      duplicate: Boolean(result.duplicate),
      durable: Boolean(result.durable)
    };
  }

  async function enqueueWorkers({ workerIds = APEX_WORKERS.map(worker => worker.id), context = {}, limit = 128 } = {}) {
    if (!Array.isArray(workerIds)) throw new TypeError("workerIds must be an array");
    const count = Math.max(0, Math.min(workerIds.length, Math.floor(Number(limit) || 128)));
    const results = [];
    for (let offset = 0; offset < count; offset += 1) {
      results.push(await enqueueWorker(workerIds[offset], { context }));
    }
    return {
      requested: count,
      enqueued: results.filter(result => result.durable && !result.duplicate).length,
      duplicates: results.filter(result => result.duplicate).length,
      results
    };
  }

  return { enqueueWorker, enqueueWorkers };
}
