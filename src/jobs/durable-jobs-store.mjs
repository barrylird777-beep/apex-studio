import { randomUUID } from 'node:crypto';

const row = (r) => r && ({
  id: r.id,
  type: r.type,
  payload: r.payload,
  status: r.status,
  runAt: r.run_at,
  attempts: r.attempts,
  maxAttempts: r.max_attempts,
  leaseOwner: r.lease_owner,
  leaseToken: r.lease_token,
  leaseFence: Number(r.lease_fence),
  leaseExpiresAt: r.lease_expires_at,
  result: r.result,
  lastError: r.last_error,
  dedupeKey: r.dedupe_key,
  recoveredCount: r.recovered_count,
  createdAt: r.created_at,
  updatedAt: r.updated_at
});

export function createDurableJobsStore(db) {
  if (!db || typeof db.query !== 'function') {
    throw new TypeError('createDurableJobsStore requires PostgreSQL query()');
  }

  const query = (text, params) => db.query(text, params);
  const one = async (text, params) => row((await query(text, params)).rows[0]);
  const changed = async (text, params) => (await query(text, params)).rowCount === 1;

  return {
    enqueue: async ({ id = randomUUID(), type, payload, runAt = new Date(), maxAttempts = 8, dedupeKey, now = new Date() }) => {
      if (!type) throw new TypeError('durable job type is required');
      const normalizedType = String(type).trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalizedType)) {
        throw new TypeError('durable job type contains invalid characters or is too long');
      }
      const normalizedMaxAttempts = Number(maxAttempts);
      if (!Number.isInteger(normalizedMaxAttempts) || normalizedMaxAttempts < 1 || normalizedMaxAttempts > 1000) {
        throw new TypeError('durable job maxAttempts must be an integer from 1 to 1000');
      }
      const serializedPayload = JSON.stringify(payload ?? {});
      if (Buffer.byteLength(serializedPayload, 'utf8') > 1048576) {
        throw new RangeError('durable job payload exceeds 1 MiB');
      }
      const normalizedDedupe = dedupeKey == null ? null : String(dedupeKey).trim().slice(0, 512);
      const inserted = await one(
        `INSERT INTO durable_jobs
          (id, type, payload, status, run_at, max_attempts, dedupe_key, created_at, updated_at)
         VALUES ($1,$2,$3::jsonb,'queued',$4,$5,$6,$7,$7)
         ON CONFLICT (dedupe_key)
         WHERE dedupe_key IS NOT NULL AND status IN ('queued','running')
         DO NOTHING
         RETURNING *`,
        [id, normalizedType, serializedPayload, runAt, normalizedMaxAttempts, normalizedDedupe, now]
      );
      if (inserted) return inserted;
      if (!normalizedDedupe) return null;
      return one(
        `SELECT * FROM durable_jobs
         WHERE dedupe_key = $1 AND status IN ('queued','running')
         ORDER BY updated_at DESC
         LIMIT 1`,
        [normalizedDedupe]
      );
    },

    claimBatch: async ({ workerId, now = new Date(), leaseMs = 30000, batchSize = 20 }) => {
      const size = Math.max(1, Number(batchSize) || 1);
      const result = await query(
        `WITH next AS (
           SELECT id
           FROM durable_jobs
           WHERE status = 'queued' AND run_at <= $1
           ORDER BY run_at, created_at
           LIMIT $4
           FOR UPDATE SKIP LOCKED
         )
         UPDATE durable_jobs j
         SET status = 'running',
             lease_owner = $2,
             lease_token = md5(random()::text || clock_timestamp()::text || j.id::text)::uuid,
             lease_fence = j.lease_fence + 1,
             lease_expires_at = $1 + ($3::double precision * INTERVAL '1 millisecond'),
             attempts = j.attempts + 1,
             updated_at = $1
         FROM next
         WHERE j.id = next.id
         RETURNING j.*`,
        [now, workerId, leaseMs, size]
      );
      return result.rows.map(row);
    },

    claimOne: async ({ workerId, now = new Date(), leaseMs = 30000 }) => {
      const token = randomUUID();
      return one(
        `WITH next AS (
           SELECT id
           FROM durable_jobs
           WHERE status = 'queued' AND run_at <= $1
           ORDER BY run_at, created_at
           LIMIT 1
           FOR UPDATE SKIP LOCKED
         )
         UPDATE durable_jobs j
         SET status = 'running',
             lease_owner = $2,
             lease_token = $3::uuid,
             lease_fence = j.lease_fence + 1,
             lease_expires_at = $1 + ($4::double precision * INTERVAL '1 millisecond'),
             attempts = j.attempts + 1,
             updated_at = $1
         FROM next
         WHERE j.id = next.id
         RETURNING j.*`,
        [now, workerId, token, leaseMs]
      );
    },

    heartbeat: ({ id, token, fence, now = new Date(), leaseMs = 30000 }) => changed(
      `UPDATE durable_jobs
       SET lease_expires_at = $4 + ($5::double precision * INTERVAL '1 millisecond'),
           updated_at = $4
       WHERE id = $1 AND status = 'running'
         AND lease_token = $2::uuid AND lease_fence = $3
         AND lease_expires_at > $4`,
      [id, token, fence, now, leaseMs]
    ),

    complete: ({ id, token, fence, result, now = new Date() }) => changed(
      `UPDATE durable_jobs
       SET status = 'completed', result = $4::jsonb,
           lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
           updated_at = $5
       WHERE id = $1 AND status = 'running'
         AND lease_token = $2::uuid AND lease_fence = $3
         AND lease_expires_at > $5`,
      [id, token, fence, JSON.stringify(result ?? null), now]
    ),

    fail: ({ id, token, fence, error, now = new Date(), retryAt }) => changed(
      `UPDATE durable_jobs
       SET status = CASE WHEN attempts >= max_attempts OR $5::timestamptz IS NULL THEN 'dead' ELSE 'queued' END,
           run_at = CASE WHEN attempts >= max_attempts THEN run_at ELSE $5::timestamptz END,
           last_error = $4, lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
           updated_at = $6
       WHERE id = $1 AND status = 'running'
         AND lease_token = $2::uuid AND lease_fence = $3
         AND lease_expires_at > $6`,
      [id, token, fence, error, retryAt ?? null, now]
    ),

    recoverExpired: async ({ now = new Date(), runAt = now, errorFor }) => {
      const result = await query(
        `WITH expired AS (
           SELECT id, lease_token, lease_fence, attempts
           FROM durable_jobs
           WHERE status = 'running' AND lease_expires_at < $1
           ORDER BY lease_expires_at
           FOR UPDATE SKIP LOCKED
         )
         UPDATE durable_jobs j
         SET status = CASE WHEN j.attempts >= j.max_attempts THEN 'dead' ELSE 'queued' END,
             run_at = CASE WHEN j.attempts >= j.max_attempts THEN j.run_at ELSE $2 END,
             last_error = $3, lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
             recovered_count = j.recovered_count + 1, updated_at = $1
         FROM expired
         WHERE j.id = expired.id AND j.lease_token = expired.lease_token
           AND j.lease_fence = expired.lease_fence
         RETURNING j.*`,
        [now, runAt, errorFor ?? 'lease expired']
      );
      return result.rows.map(row);
    }
  };
}

export default createDurableJobsStore;