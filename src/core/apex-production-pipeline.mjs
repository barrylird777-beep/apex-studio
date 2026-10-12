import { randomUUID } from 'node:crypto';
import { createDurableJobsStore } from '../jobs/durable-jobs-store.mjs';

const DEFAULT_CONCURRENCY = 32;
const MAX_BATCH_SIZE = 20;

export class ApexProductionPipeline {
  constructor({ db, concurrency = DEFAULT_CONCURRENCY, workerId } = {}) {
    if (!db || typeof db.query !== 'function') {
      throw new TypeError('ApexProductionPipeline requires a PostgreSQL client');
    }

    this.db = db;
    this.concurrency = Math.max(1, Math.min(32, Number(concurrency) || DEFAULT_CONCURRENCY));
    this.workerId = workerId || `pipeline-${randomUUID()}`;
    this.jobs = createDurableJobsStore(db);
    this.active = new Map();
  }

  async enqueue(taskPayload = {}) {
    const taskType = typeof taskPayload.taskType === 'string' && taskPayload.taskType.trim()
      ? taskPayload.taskType.trim()
      : 'media-render-episode';

    const dedupeKey = typeof taskPayload.dedupeKey === 'string' && taskPayload.dedupeKey.trim()
      ? taskPayload.dedupeKey.trim()
      : `pipeline:${randomUUID()}`;

    const job = await this.jobs.enqueue({
      id: randomUUID(),
      type: taskType,
      payload: { ...taskPayload, taskType },
      maxAttempts: 8,
      dedupeKey,
      runAt: new Date(),
      now: new Date()
    });

    if (!job) throw new Error('durable job enqueue returned no job');

    return {
      jobId: job.id,
      taskType,
      status: job.status,
      dedupeKey,
      durable: true,
      completed: false
    };
  }

  async claimWork({ leaseMs = 30000, batchSize = MAX_BATCH_SIZE } = {}) {
    const capacity = Math.max(0, this.concurrency - this.active.size);
    if (!capacity) return [];

    return this.jobs.claimBatch({
      workerId: this.workerId,
      now: new Date(),
      leaseMs,
      batchSize: Math.min(MAX_BATCH_SIZE, capacity, Number(batchSize) || MAX_BATCH_SIZE)
    });
  }

  async executeClaimedJob(job, executor) {
    if (!job?.id || !job.leaseToken || job.leaseFence == null) {
      throw new Error('invalid durable job claim');
    }
    if (typeof executor !== 'function') {
      throw new Error(`no executor registered for job type: ${job.type}`);
    }

    this.active.set(job.id, job);

    try {
      const result = await executor(job);
      const completed = await this.jobs.complete({
        id: job.id,
        token: job.leaseToken,
        fence: job.leaseFence,
        result,
        now: new Date()
      });
      if (!completed) {
        throw new Error(`stale durable completion rejected: ${job.id}`);
      }
      return { jobId: job.id, status: 'completed', result };
    } catch (error) {
      const attempts = Number(job.attempts) || 1;
      const maxAttempts = Number(job.maxAttempts) || 1;
      const retryAt = attempts < maxAttempts
        ? new Date(Date.now() + Math.min(60000, 1000 * 2 ** Math.max(0, attempts - 1)))
        : null;

      await this.jobs.fail({
        id: job.id,
        token: job.leaseToken,
        fence: job.leaseFence,
        error: error instanceof Error ? error.message : String(error),
        now: new Date(),
        retryAt
      });
      throw error;
    } finally {
      this.active.delete(job.id);
    }
  }

  async shutdown() {
    this.active.clear();
  }
}

export default ApexProductionPipeline;
