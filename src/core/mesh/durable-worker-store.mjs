import pg from "pg";

const { Pool } = pg;
let pool;

export function durableWorkerEnabled() {
  return Boolean(String(process.env.DATABASE_URL || "").trim());
}

function getPool() {
  if (!durableWorkerEnabled()) return null;
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Math.max(5, Math.min(10, Number(process.env.APEX_WORKER_DB_POOL_MAX || 8))) });
  return pool;
}

export async function ensureWorkerTaskSchema() {
  if (!durableWorkerEnabled()) return false;
  await getPool().query(`CREATE TABLE IF NOT EXISTS apex_worker_tasks (
    id UUID PRIMARY KEY,
    worker_id TEXT NOT NULL,
    role TEXT NOT NULL,
    task TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    lease_owner TEXT,
    lease_token TEXT,
    lease_expires_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    result JSONB,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await getPool().query(`ALTER TABLE apex_worker_tasks ADD COLUMN IF NOT EXISTS lease_token TEXT`);
  await getPool().query(`ALTER TABLE apex_worker_tasks ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ`);
  await getPool().query(`CREATE INDEX IF NOT EXISTS apex_worker_tasks_queue_idx ON apex_worker_tasks(status, created_at)`);
  await getPool().query(`CREATE INDEX IF NOT EXISTS apex_worker_tasks_lease_idx ON apex_worker_tasks(status, lease_expires_at)`);
  return true;
}

export async function enqueueWorkerTask({ id, workerId, role, task, payload = {}, maxAttempts = 5 }) {
  if (!durableWorkerEnabled()) return { durable: false, id };
  const db = getPool();
  await ensureWorkerTaskSchema();
  await db.query(`INSERT INTO apex_worker_tasks
    (id, worker_id, role, task, payload, max_attempts)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6)
    ON CONFLICT (id) DO NOTHING`,
    [id, String(workerId), String(role || "general"), String(task || ""), JSON.stringify(payload), Math.max(1, Number(maxAttempts) || 5)]);
  return { durable: true, id };
}

export async function claimNextWorkerTasks(limit = 20, leaseMs = 45000) {
  if (!durableWorkerEnabled()) return [];
  const db = getPool();
  await ensureWorkerTaskSchema();
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const r = await db.query(`WITH candidate AS (
    SELECT id FROM apex_worker_tasks
    WHERE status='queued' AND attempts < max_attempts AND (next_run_at IS NULL OR next_run_at <= NOW())
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT $1
  ) UPDATE apex_worker_tasks t
    SET status='running', attempts=attempts+1,
        lease_owner=$2, lease_token=md5(random()::text || clock_timestamp()::text || t.id::text), lease_expires_at=NOW()+($3::double precision * INTERVAL '1 millisecond'),
        updated_at=NOW()
    FROM candidate
    WHERE t.id=candidate.id
    RETURNING t.*`,
    [safeLimit, process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local", leaseMs]);
  return r.rows;
}

export async function claimNextWorkerTask(leaseMs = 45000) {
  const tasks = await claimNextWorkerTasks(1, leaseMs);
  return tasks[0] || null;
}

export async function claimWorkerTask(id, leaseMs = 45000) {
  if (!durableWorkerEnabled()) return null;
  const db = getPool();
  await ensureWorkerTaskSchema();
  const r = await db.query(`UPDATE apex_worker_tasks
    SET status='running', attempts=attempts+1,
        lease_owner=$2, lease_token=md5(random()::text || clock_timestamp()::text || $1::text), lease_expires_at=NOW()+($3::double precision * INTERVAL '1 millisecond'),
        updated_at=NOW()
    WHERE id=$1 AND (status='queued' OR (status='running' AND lease_expires_at<NOW()))
      AND attempts < max_attempts
    RETURNING *`, [id, process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local", leaseMs]);
  return r.rows[0] || null;
}

export async function heartbeatWorkerTask(id, leaseMs = 45000, leaseToken) {
  if (!durableWorkerEnabled()) return false;
  const r = await getPool().query(`UPDATE apex_worker_tasks
    SET lease_expires_at=NOW()+($3::double precision * INTERVAL '1 millisecond'), updated_at=NOW()
    WHERE id=$1 AND lease_owner=$2 AND lease_token=$4 AND status='running'`,
    [id, process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local", leaseMs, leaseToken]);
  return r.rowCount === 1;
}

export async function completeWorkerTask(id, result = null, leaseToken) {
  if (!durableWorkerEnabled()) return false;
  const r = await getPool().query(`UPDATE apex_worker_tasks
    SET status='completed', lease_owner=NULL, lease_token=NULL, lease_expires_at=NULL, next_run_at=NULL, result=$3::jsonb, updated_at=NOW()
    WHERE id=$1 AND lease_owner=$2 AND lease_token=$4 AND status='running'`,
    [id, process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local", JSON.stringify(result), leaseToken]);
  return r.rowCount === 1;
}

export async function failWorkerTask(id, error, leaseToken) {
  if (!durableWorkerEnabled()) return false;
  const message = String(error?.message || error || "Worker task failed").slice(0,4000);
  const r = await getPool().query(`UPDATE apex_worker_tasks
    SET status=CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
        lease_owner=NULL, lease_token=NULL, lease_expires_at=NULL,
        next_run_at=CASE WHEN attempts >= max_attempts THEN NULL ELSE NOW() + ((LEAST(300, POWER(2, attempts)) + (random() * 5)) * INTERVAL '1 second') END,
        last_error=$3, updated_at=NOW()
    WHERE id=$1 AND lease_owner=$2 AND lease_token=$4 AND status='running'`,
    [id, process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local", message, leaseToken]);
  return r.rowCount === 1;
}

export async function releaseWorkerTasks(taskIds = []) {
  if (!durableWorkerEnabled() || !taskIds.length) return 0;
  const db = getPool();
  const r = await db.query("UPDATE apex_worker_tasks SET status='queued', lease_owner=NULL, lease_expires_at=NULL, updated_at=NOW() WHERE id = ANY($1::uuid[]) AND status='running' AND lease_owner=$2", [taskIds, process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local"]);
  return r.rowCount;
}

export async function requeueExpiredWorkerTasks(limit = 500) {
  if (!durableWorkerEnabled()) return 0;
  await ensureWorkerTaskSchema();
  const r = await getPool().query(`WITH x AS (
    SELECT id FROM apex_worker_tasks WHERE status='running' AND lease_expires_at<NOW()
    ORDER BY lease_expires_at LIMIT $1
  ) UPDATE apex_worker_tasks t SET
    status=CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
    lease_owner=NULL, lease_token=NULL, lease_expires_at=NULL,
    next_run_at=CASE WHEN attempts >= max_attempts THEN NULL ELSE NOW() + ((LEAST(300, POWER(2, attempts)) + (random() * 5)) * INTERVAL '1 second') END,
    last_error='Worker lease expired; task reclaimed', updated_at=NOW()
    FROM x WHERE t.id=x.id RETURNING t.id`, [limit]);
  return r.rowCount;
}

export async function acquireAiRateLimit({ capacity = 2, refillPerSecond = 1 } = {}) {
  if (!durableWorkerEnabled()) return true;
  const db = getPool();
  await db.query(`CREATE TABLE IF NOT EXISTS apex_ai_rate_limiter (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    tokens DOUBLE PRECISION NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  const refill = Math.max(0.01, Number(refillPerSecond) || 1);
  const cap = Math.max(1, Number(capacity) || 2);
  const r = await db.query(`INSERT INTO apex_ai_rate_limiter(id, tokens)
    VALUES (1, $1)
    ON CONFLICT (id) DO UPDATE SET
      tokens=LEAST($1, apex_ai_rate_limiter.tokens + EXTRACT(EPOCH FROM (NOW()-apex_ai_rate_limiter.updated_at))*$2),
      updated_at=NOW()
    RETURNING tokens`, [cap, refill]);
  if (Number(r.rows[0].tokens) < 1) return false;
  const take = await db.query(`UPDATE apex_ai_rate_limiter
    SET tokens=tokens-1, updated_at=NOW()
    WHERE id=1 AND tokens >= 1
    RETURNING tokens`);
  return take.rowCount === 1;
}

export async function queueStats() {
  if (!durableWorkerEnabled()) return { durable: false };
  await ensureWorkerTaskSchema();
  const db = getPool();
  const r = await db.query(`SELECT
    COUNT(*) FILTER (WHERE status='queued')::int AS queued,
    COUNT(*) FILTER (WHERE status='running')::int AS running,
    COUNT(*) FILTER (WHERE status='completed')::int AS completed,
    COUNT(*) FILTER (WHERE status='failed')::int AS failed,
    COUNT(*)::int AS total
    FROM apex_worker_tasks`);
  return { durable: true, ...r.rows[0] };
}

export async function closeWorkerStore() {
  if (pool) await pool.end();
  pool = null;
}
