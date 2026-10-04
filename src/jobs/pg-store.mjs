export const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('queued','running','done','dead')),
  run_at bigint NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL,
  lease_token text,
  lease_expires_at bigint,
  worker_id text,
  last_error text,
  result jsonb,
  dedupe_key text,
  recovered_count int NOT NULL DEFAULT 0,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_claim_idx ON jobs (run_at, created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS jobs_lease_idx ON jobs (lease_expires_at) WHERE status = 'running';
CREATE UNIQUE INDEX IF NOT EXISTS jobs_dedupe_idx ON jobs (dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status IN ('queued','running');
CREATE TABLE IF NOT EXISTS job_workers (
  id text PRIMARY KEY,
  last_seen bigint NOT NULL,
  info jsonb NOT NULL DEFAULT '{}'
);
`;

const num = (v) => (v === null || v === undefined ? null : Number(v));
const row = (r) => r && ({
  id: r.id, type: r.type, payload: r.payload, status: r.status, runAt: num(r.run_at),
  attempts: r.attempts, maxAttempts: r.max_attempts, leaseToken: r.lease_token,
  leaseExpiresAt: num(r.lease_expires_at), workerId: r.worker_id, lastError: r.last_error,
  result: r.result, dedupeKey: r.dedupe_key, recoveredCount: r.recovered_count,
  createdAt: num(r.created_at), updatedAt: num(r.updated_at),
});

export function createPgStore(db) {
  if (!db || typeof db.query !== 'function') throw new Error('createPgStore requires a database with query(text, params)');
  const q = (text, params) => db.query(text, params);
  const one = async (text, params) => row((await q(text, params)).rows[0]);
  const many = async (text, params) => (await q(text, params)).rows.map(row);
  const changed = async (text, params) => (await q(text, params)).rowCount === 1;

  return {
    async enqueue({ id, type, payload, runAt, maxAttempts, dedupeKey, now }) {
      const ins = await one(
        `INSERT INTO jobs (id,type,payload,status,run_at,max_attempts,dedupe_key,created_at,updated_at)
         VALUES ($1,$2,$3::jsonb,'queued',$4,$5,$6,$7,$7)
         ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued','running') DO NOTHING
         RETURNING *`,
        [id, type, JSON.stringify(payload), runAt, maxAttempts, dedupeKey, now],
      );
      if (ins) return ins;
      return one(`SELECT * FROM jobs WHERE dedupe_key = $1 AND status IN ('queued','running') LIMIT 1`, [dedupeKey]);
    },

    claimOne: ({ workerId, now, leaseMs, token }) => one(
      `WITH next AS (
         SELECT id FROM jobs WHERE status = 'queued' AND run_at <= $1
         ORDER BY run_at, created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
       UPDATE jobs j SET status = 'running', lease_token = $2, lease_expires_at = $1 + $3::bigint,
         worker_id = $4, attempts = j.attempts + 1, updated_at = $1
       FROM next WHERE j.id = next.id RETURNING j.*`,
      [now, token, leaseMs, workerId],
    ),

    heartbeat: ({ id, token, now, leaseMs }) => changed(
      `UPDATE jobs SET lease_expires_at = $3::bigint + $4::bigint, updated_at = $3
       WHERE id = $1 AND status = 'running' AND lease_token = $2`,
      [id, token, now, leaseMs],
    ),

    complete: ({ id, token, result, now }) => changed(
      `UPDATE jobs SET status = 'done', result = $3::jsonb, lease_token = NULL, lease_expires_at = NULL, updated_at = $4
       WHERE id = $1 AND status = 'running' AND lease_token = $2`,
      [id, token, JSON.stringify(result ?? null), now],
    ),

    fail: ({ id, token, error, now, retryAt }) => changed(
      `UPDATE jobs SET status = CASE WHEN $4::bigint IS NULL THEN 'dead' ELSE 'queued' END,
         run_at = COALESCE($4::bigint, run_at), last_error = $3,
         lease_token = NULL, lease_expires_at = NULL, updated_at = $5
       WHERE id = $1 AND status = 'running' AND lease_token = $2`,
      [id, token, error, retryAt, now],
    ),

    listExpired: ({ now }) => many(`SELECT * FROM jobs WHERE status = 'running' AND lease_expires_at < $1`, [now]),

    requeueExpired: ({ id, token, dead, now, runAt, error }) => changed(
      `UPDATE jobs SET status = CASE WHEN $3::boolean THEN 'dead' ELSE 'queued' END,
         run_at = $4, last_error = $5, lease_token = NULL, lease_expires_at = NULL,
         recovered_count = recovered_count + 1, updated_at = $6
       WHERE id = $1 AND status = 'running' AND lease_token = $2 AND lease_expires_at < $6`,
      [id, token, dead, runAt, error, now],
    ),

    async touchWorker({ id, now, info }) {
      await q(
        `INSERT INTO job_workers (id,last_seen,info) VALUES ($1,$2,$3::jsonb)
         ON CONFLICT (id) DO UPDATE SET last_seen = EXCLUDED.last_seen, info = EXCLUDED.info`,
        [id, now, JSON.stringify(info ?? {})],
      );
    },
    async listWorkers() {
      return (await q(`SELECT id, last_seen, info FROM job_workers ORDER BY id`)).rows
        .map((r) => ({ id: r.id, lastSeen: num(r.last_seen), info: r.info }));
    },
    async counts() {
      const c = { queued: 0, running: 0, done: 0, dead: 0 };
      for (const r of (await q(`SELECT status, count(*)::int AS n FROM jobs GROUP BY status`)).rows) c[r.status] = r.n;
      return c;
    },
    listByStatus: (status, limit = 50) => many(`SELECT * FROM jobs WHERE status = $1 ORDER BY updated_at DESC LIMIT $2`, [status, limit]),
    listRetrying: (limit = 50) => many(`SELECT * FROM jobs WHERE status = 'queued' AND attempts > 0 ORDER BY run_at LIMIT $1`, [limit]),
    listRecovered: (limit = 50) => many(`SELECT * FROM jobs WHERE recovered_count > 0 ORDER BY updated_at DESC LIMIT $1`, [limit]),
  };
}
