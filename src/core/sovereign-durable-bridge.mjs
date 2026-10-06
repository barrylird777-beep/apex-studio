const DEFAULT_MAX_ATTEMPTS = Number(process.env.APEX_SOVEREIGN_MAX_ATTEMPTS || 8);
const DEFAULT_ROLE = process.env.APEX_SOVEREIGN_ROLE || 'sovereign-mesh';
const DEFAULT_TASK = process.env.APEX_SOVEREIGN_TASK || 'publish';

function requireDb(db) {
  if (!db || typeof db.query !== 'function') {
    throw new TypeError('Sovereign durable bridge requires a PostgreSQL client');
  }
}

export function createSovereignDurableBridge({ engine, db, workerId }) {
  if (!engine) throw new TypeError('engine is required');
  if (!workerId) throw new Error('workerId is required');
  requireDb(db);

  async function persist(record, options = {}) {
    const now = options.now ?? new Date();
    const id = record.waveId;
    const dedupeKey = `sovereign:${record.waveId}`;

    const result = await db.query(
      `INSERT INTO apex_worker_tasks
        (id, worker_id, role, task, status, attempts, max_attempts,
         next_run_at, payload, dedupe_key, created_at, updated_at)
       VALUES
        ($1, $2, $3, $4, 'queued', 0, $5, $6, $7::jsonb, $8, $6, $6)
       ON CONFLICT (dedupe_key)
       WHERE dedupe_key IS NOT NULL AND status IN ('queued','running')
       DO NOTHING
       RETURNING id, status, dedupe_key`,
      [
        id,
        workerId,
        options.role ?? DEFAULT_ROLE,
        options.task ?? DEFAULT_TASK,
        options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        now,
        JSON.stringify({
          source: 'sovereign-wal',
          seq: record.seq,
          waveId: record.waveId,
          peerId: record.peerId,
          action: record.action,
          timestamp: record.timestamp,
          payload: record.payload,
          checksum: record.checksum
        }),
        dedupeKey
      ]
    );

    if (result.rows[0]) return result.rows[0];

    const existing = await db.query(
      `SELECT id, status, dedupe_key
       FROM apex_worker_tasks
       WHERE dedupe_key = $1 AND status IN ('queued','running')
       LIMIT 1`,
      [dedupeKey]
    );

    if (!existing.rows[0]) {
      throw new Error(`Durable task disappeared during idempotent insert: ${dedupeKey}`);
    }

    return existing.rows[0];
  }

  async function dispatch(payload, options = {}) {
    const record = await engine.dispatchAutonomousPayload(payload);
    const task = await persist(record, options);
    return { record, task };
  }

  async function reconcile(options = {}) {
    const records = engine.snapshot();
    const results = [];
    const errors = [];

    for (const record of records) {
      try {
        const task = await persist(record, options);
        results.push({ waveId: record.waveId, taskId: task.id, status: task.status });
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
