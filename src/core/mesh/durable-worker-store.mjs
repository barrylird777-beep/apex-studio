import pg from "pg";

const { Pool } = pg;
let pool;

export function durableWorkerEnabled() {
  return Boolean(String(process.env.DATABASE_URL || "").trim());
}

function getPool() {
  if (!durableWorkerEnabled()) return null;
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
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
    lease_expires_at TIMESTAMPTZ,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    result JSONB,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
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

export async function claimWorkerTask(id, leaseMs = 45000) {
  if (!durableWorkerEnabled()) return null;
  const db = getPool();
  await ensureWorkerTaskSchema();
  const r = await db.query(`UPDATE apex_worker_tasks
    SET status='running', attempts=attempts+1,
        lease_owner=$2, lease_expires_at=NOW()+($3::double precision * INTERVAL '1 millisecond'),
        updated_at=NOW()
    WHERE id=$1 AND (status='queued' OR (status='running' AND lease_expires_at<NOW()))
      AND attempts < max_attempts
    RETURNING *`, [id, process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local", leaseMs]);
  return r.rows[0] || null;
}

export async function heartbeatWorkerTask(id, leaseMs = 45000) {
  if (!durableWorkerEnabled()) return false;
  const r = await getPool().query(`UPDATE apex_worker_tasks
    SET lease_expires_at=NOW()+($3::double precision * INTERVAL '1 millisecond'), updated_at=NOW()
    WHERE id=$1 AND lease_owner=$2 AND status='running'`,
    [id, process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local", leaseMs]);
  return r.rowCount === 1;
}

export async function completeWorkerTask(id, result = null) {
  if (!durableWorkerEnabled()) return false;
  const r = await getPool().query(`UPDATE apex_worker_tasks
    SET status='completed', lease_owner=NULL, lease_expires_at=NULL, result=$3::jsonb, updated_at=NOW()
    WHERE id=$1 AND lease_owner=$2 AND status='running'`,
    [id, process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local", JSON.stringify(result)]);
  return r.rowCount === 1;
}

export async function failWorkerTask(id, error) {
  if (!durableWorkerEnabled()) return false;
  const message = String(error?.message || error || "Worker task failed").slice(0,4000);
  const r = await getPool().query(`UPDATE apex_worker_tasks
    SET status=CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
        lease_owner=NULL, lease_expires_at=NULL, last_error=$3, updated_at=NOW()
    WHERE id=$1 AND lease_owner=$2 AND status='running'`,
    [id, process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local", message]);
  return r.rowCount === 1;
}

export async function requeueExpiredWorkerTasks(limit = 500) {
  if (!durableWorkerEnabled()) return 0;
  await ensureWorkerTaskSchema();
  const r = await getPool().query(`WITH x AS (
    SELECT id FROM apex_worker_tasks WHERE status='running' AND lease_expires_at<NOW()
    ORDER BY lease_expires_at LIMIT $1
  ) UPDATE apex_worker_tasks t SET
    status=CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
    lease_owner=NULL, lease_expires_at=NULL,
    last_error='Worker lease expired; task reclaimed', updated_at=NOW()
    FROM x WHERE t.id=x.id RETURNING t.id`, [limit]);
  return r.rowCount;
}

export async function queueStats() {
  if (!durableWorkerEnabled()) return { durable: false };
  const db = getPool();
  await db.query(`CREATE TABLE IF NOT EXISTS apex_worker_tasks (
    id UUID PRIMARY KEY,
    worker_id TEXT NOT NULL,
    role TEXT NOT NULL,
    task TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    lease_owner TEXT,
    lease_expires_at TIMESTAMPTZ,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    result JSONB,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
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
