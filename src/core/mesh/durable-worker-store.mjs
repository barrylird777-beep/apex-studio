import pg from "pg";
import crypto from "node:crypto";

const { Pool } = pg;
let pool;
const PROCESS_OWNER = String(process.env.APEX_WORKER_OWNER || process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local") + ":" + crypto.randomUUID();

export function durableWorkerEnabled() {
  return Boolean(String(process.env.DATABASE_URL || "").trim());
}

function getPool() {
  if (!durableWorkerEnabled()) return null;
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Math.max(8, Math.min(32, Number(process.env.APEX_WORKER_DB_POOL_MAX || 20))) });
  return pool;
}

export async function ensureWorkerTaskSchema() {
  if (!durableWorkerEnabled()) return false;
  const db = getPool();
  const table = await db.query("SELECT to_regclass('public.apex_worker_tasks') AS name");
  if (!table.rows[0]?.name) throw new Error("apex_worker_tasks is missing; run database migrations");
  const columns = await db.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='apex_worker_tasks'
  `);
  const required = new Set(["id","worker_id","role","task","status","attempts","max_attempts","lease_owner","lease_token","lease_expires_at","next_run_at","payload","result","last_error","created_at","updated_at"]);
  const missing = [...required].filter(column => !columns.rows.some(row => row.column_name === column));
  if (missing.length) throw new Error("apex_worker_tasks schema is missing: " + missing.join(", "));
  return true;
}

function owner() { return PROCESS_OWNER; }
function boundedLeaseMs(value) { return Math.max(5000, Math.min(24 * 60 * 60 * 1000, Number(value) || 45000)); }

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

export async function claimNextWorkerTasks(limit = 20, leaseMs = 45000, taskType = null, workerOwner = owner()) {
  if (!durableWorkerEnabled()) return [];
  const db = getPool();
  await ensureWorkerTaskSchema();
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const lease = boundedLeaseMs(leaseMs);
  const r = await db.query(`WITH candidate AS (
    SELECT id FROM apex_worker_tasks
    WHERE status='queued' AND attempts < max_attempts
      AND (next_run_at IS NULL OR next_run_at <= NOW())
      AND ($4::text IS NULL OR task=$4)
    ORDER BY created_at, id
    FOR UPDATE SKIP LOCKED LIMIT $1
  )
  UPDATE apex_worker_tasks t SET
    status='claimed', attempts=attempts+1, lease_owner=$2,
    lease_token=md5(random()::text || clock_timestamp()::text || id::text),
    lease_expires_at=NOW()+($3::double precision * INTERVAL '1 millisecond'),
    updated_at=NOW()
  FROM candidate WHERE t.id=candidate.id
  RETURNING t.*`, [safeLimit, workerOwner, lease, taskType]);
  return r.rows;
}

export async function claimNextWorkerTask(leaseMs = 45000, taskType = null, workerOwner = owner()) {
  const tasks = await claimNextWorkerTasks(1, leaseMs, taskType, workerOwner);
  return tasks[0] || null;
}

export async function claimWorkerTask(id, leaseMs = 45000, workerOwner = owner()) {
  if (!durableWorkerEnabled()) return null;
  const db = getPool();
  await ensureWorkerTaskSchema();
  const r = await db.query(`UPDATE apex_worker_tasks SET
    status='claimed', attempts=attempts+1, lease_owner=$2,
    lease_token=gen_random_uuid()::text,
    lease_expires_at=NOW()+($3::double precision * INTERVAL '1 millisecond'),
    updated_at=NOW()
    WHERE id=$1 AND status='queued' AND attempts < max_attempts
      AND (next_run_at IS NULL OR next_run_at <= NOW())
    RETURNING *`, [id, workerOwner, boundedLeaseMs(leaseMs)]);
  return r.rows[0] || null;
}

export async function startWorkerTask(id, leaseToken, workerOwner = owner()) {
  if (!durableWorkerEnabled()) return false;
  const r = await getPool().query(`UPDATE apex_worker_tasks
    SET status='running', updated_at=NOW()
    WHERE id=$1 AND lease_owner=$2 AND lease_token=$3
      AND status='claimed' AND lease_expires_at > NOW()`, [id, workerOwner, leaseToken]);
  return r.rowCount === 1;
}

export async function heartbeatWorkerTask(id, leaseMs = 45000, leaseToken, workerOwner = owner()) {
  if (!durableWorkerEnabled()) return false;
  const r = await getPool().query(`UPDATE apex_worker_tasks
    SET lease_expires_at=NOW()+($3::double precision * INTERVAL '1 millisecond'), updated_at=NOW()
    WHERE id=$1 AND lease_owner=$2 AND lease_token=$4
      AND status IN ('claimed','running')`, [id, workerOwner, boundedLeaseMs(leaseMs), leaseToken]);
  return r.rowCount === 1;
}

export async function completeWorkerTask(id, result = null, leaseToken, workerOwner = owner()) {
  if (!durableWorkerEnabled()) return false;
  const r = await getPool().query(`UPDATE apex_worker_tasks SET
    status='completed', lease_owner=NULL, lease_token=NULL, lease_expires_at=NULL,
    next_run_at=NULL, result=$3::jsonb, updated_at=NOW()
    WHERE id=$1 AND lease_owner=$2 AND lease_token=$4 AND status='running'`,
    [id, workerOwner, JSON.stringify(result), leaseToken]);
  return r.rowCount === 1;
}

export async function failWorkerTask(id, error, leaseToken, workerOwner = owner()) {
  if (!durableWorkerEnabled()) return false;
  const message = String(error?.message || error || "Worker task failed").slice(0,4000);
  const r = await getPool().query(`UPDATE apex_worker_tasks SET
    status=CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
    lease_owner=NULL, lease_token=NULL, lease_expires_at=NULL,
    next_run_at=CASE WHEN attempts >= max_attempts THEN NULL ELSE NOW() + (LEAST(300, POWER(2, attempts)) + random()*5) * INTERVAL '1 second' END,
    last_error=$3, updated_at=NOW()
    WHERE id=$1 AND lease_owner=$2 AND lease_token=$4 AND status IN ('claimed','running')`,
    [id, workerOwner, message, leaseToken]);
  return r.rowCount === 1;
}

export async function releaseWorkerTasks(taskIds = [], workerOwner = owner()) {
  if (!durableWorkerEnabled() || !taskIds.length) return 0;
  const r = await getPool().query(`UPDATE apex_worker_tasks SET
    status='queued', attempts=GREATEST(0, attempts-1),
    lease_owner=NULL, lease_token=NULL, lease_expires_at=NULL,
    next_run_at=NOW(), updated_at=NOW()
    WHERE id=ANY($1::uuid[]) AND status='claimed' AND lease_owner=$2
    RETURNING id`, [taskIds, workerOwner]);
  return r.rowCount;
}

export async function requeueExpiredWorkerTasks(limit = 500) {
  if (!durableWorkerEnabled()) return 0;
  await ensureWorkerTaskSchema();
  const r = await getPool().query(`WITH expired AS (
    SELECT id FROM apex_worker_tasks
    WHERE status IN ('claimed','running') AND lease_expires_at < NOW()
    ORDER BY lease_expires_at, id
    FOR UPDATE SKIP LOCKED LIMIT $1
  )
  UPDATE apex_worker_tasks t SET
    status=CASE WHEN t.attempts >= t.max_attempts THEN 'failed' ELSE 'queued' END,
    lease_owner=NULL, lease_token=NULL, lease_expires_at=NULL,
    next_run_at=CASE WHEN t.attempts >= t.max_attempts THEN NULL ELSE NOW() + (LEAST(300, POWER(2, t.attempts)) + random()*5) * INTERVAL '1 second' END,
    last_error='Worker lease expired; task reclaimed', updated_at=NOW()
  FROM expired WHERE t.id=expired.id
  RETURNING t.id`, [Math.max(1, Math.min(5000, Number(limit) || 500))]);
  return r.rowCount;
}

export async function acquireAiRateLimit({ key = "gemini", capacity = 10, refillPerSecond = 10 / 60, retryMs = 300 } = {}) {
  if (!durableWorkerEnabled()) return true;
  const db = getPool();
  const cap = Math.max(1, Number(capacity) || 10);
  const refill = Math.max(0.0001, Number(refillPerSecond) || (10 / 60));
  await db.query(`CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    tokens DOUBLE PRECISION NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await db.query(
    `INSERT INTO rate_limits (key, tokens) VALUES ($1, $2)
     ON CONFLICT (key) DO NOTHING`,
    [key, cap]
  );
  for (;;) {
    const r = await db.query(
      `UPDATE rate_limits SET
        tokens = LEAST($2, tokens + EXTRACT(EPOCH FROM (NOW() - updated_at)) * $3) - 1,
        updated_at = NOW()
       WHERE key = $1
         AND LEAST($2, tokens + EXTRACT(EPOCH FROM (NOW() - updated_at)) * $3) >= 1`,
      [key, cap, refill]
    );
    if (r.rowCount === 1) return true;
    await new Promise(resolve => setTimeout(resolve, Math.max(50, retryMs) + Math.random() * Math.max(50, retryMs)));
  }
}

export async function claimExternalEffect(idempotencyKey) {
  if (!durableWorkerEnabled()) return true;
  const key = String(idempotencyKey || "").trim();
  if (!key) throw new Error("External side effects require an idempotency key");
  const db = getPool();
  await db.query(`CREATE TABLE IF NOT EXISTS apex_external_effects (
    idempotency_key TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'started',
    result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  const r = await db.query(
    `INSERT INTO apex_external_effects (idempotency_key, status)
     VALUES ($1, 'started')
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING idempotency_key`,
    [key]
  );
  return r.rowCount === 1;
}

export async function completeExternalEffect(idempotencyKey, result = null) {
  if (!durableWorkerEnabled()) return true;
  const key = String(idempotencyKey || "").trim();
  if (!key) throw new Error("External side effects require an idempotency key");
  const r = await getPool().query(
    `UPDATE apex_external_effects
     SET status='completed', result=$2::jsonb, updated_at=NOW()
     WHERE idempotency_key=$1 AND status='started'`,
    [key, JSON.stringify(result)]
  );
  return r.rowCount === 1;
}

export async function queueStats() {
  if (!durableWorkerEnabled()) return { durable: false };
  await ensureWorkerTaskSchema();
  const db = getPool();
  const r = await db.query(`SELECT
    COUNT(*) FILTER (WHERE status='queued')::int AS queued,
    COUNT(*) FILTER (WHERE status='claimed')::int AS claimed,
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
