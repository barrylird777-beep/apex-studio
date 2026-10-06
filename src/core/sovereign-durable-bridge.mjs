import { createPgStore } from '../jobs/pg-store.mjs';

const DEFAULT_MAX_ATTEMPTS = Number(process.env.APEX_SOVEREIGN_MAX_ATTEMPTS || 8);
const DEFAULT_JOB_TYPE = process.env.APEX_SOVEREIGN_JOB_TYPE || 'sovereign.publish';

function assertStore(store) {
  if (!store || typeof store.enqueue !== 'function') {
    throw new TypeError('Sovereign durable bridge requires a PostgreSQL job store');
  }
}

export function createSovereignDurableBridge({ engine, db, workerId }) {
  if (!engine) throw new TypeError('engine is required');
  if (!workerId) throw new Error('workerId is required');

  const store = createPgStore(db);
  assertStore(store);

  async function persist(record, options = {}) {
    const now = options.now ?? Date.now();
    const job = await store.enqueue({
      id: record.waveId,
      type: options.type ?? DEFAULT_JOB_TYPE,
      payload: {
        source: 'sovereign-wal',
        seq: record.seq,
        waveId: record.waveId,
        peerId: record.peerId,
        action: record.action,
        timestamp: record.timestamp,
        payload: record.payload,
        checksum: record.checksum
      },
      runAt: now,
      maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      dedupeKey: `sovereign:${record.waveId}`,
      now
    });

    return job;
  }

  async function dispatch(payload, options = {}) {
    const record = await engine.dispatchAutonomousPayload(payload);
    const job = await persist(record, options);
    return { record, job };
  }

  async function reconcile(options = {}) {
    const records = engine.snapshot();
    const results = [];
    const errors = [];

    for (const record of records) {
      try {
        const job = await persist(record, options);
        results.push({ waveId: record.waveId, jobId: job?.id ?? null });
      } catch (error) {
        errors.push({
          waveId: record.waveId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return {
      workerId,
      scanned: records.length,
      persisted: results.length,
      failed: errors.length,
      results,
      errors
    };
  }

  return { dispatch, persist, reconcile, workerId };
}

export default createSovereignDurableBridge;
