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
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    dedupe_key TEXT,
    recovered_count INTEGER NOT NULL DEFAULT 0
  )`);
  await getPool().query(`ALTER TABLE apex_worker_tasks ADD COLUMN IF NOT EXISTS lease_token TEXT`);
  await getPool().query(`ALTER TABLE apex_worker_tasks ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ`);
  await getPool().query(`ALTER TABLE apex_worker_tasks ADD COLUMN IF NOT EXISTS dedupe_key TEXT`);
  await getPool().query(`ALTER TABLE apex_worker_tasks ADD COLUMN IF NOT EXISTS recovered_count INTEGER NOT NULL DEFAULT 0`);
  await getPool().query(`CREATE UNIQUE INDEX IF NOT EXISTS apex_worker_tasks_dedupe_idx ON apex_worker_tasks(dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued','running')`);
  await getPool().query(`CREATE INDEX IF NOT EXISTS apex_worker_tasks_queue_idx ON apex_worker_tasks(status, created_at)`);
  await getPool().query(`CREATE INDEX IF NOT EXISTS apex_worker_tasks_lease_idx ON apex_worker_tasks(status, lease_expires_at)`);
  return true;
}

export async function enqueueWorkerTask({ id, workerId, role, task, payload = {}, maxAttempts = 5, dedupeKey = null }) {
  if (!durableWorkerEnabled()) return { durable: false, id };
  const db = getPool();
  await ensureWorkerTaskSchema();
  await db.query(`INSERT INTO apex_worker_tasks
    (id, worker_id, role, task, payload, max_attempts, dedupe_key)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
    ON CONFLICT DO NOTHING`,
    [id, String(workerId), String(role || "general"), String(task || ""), JSON.stringify(payload), Math.max(1, Number(maxAttempts) || 5), dedupeKey]);
  const existing = dedupeKey ? await db.query("SELECT id FROM apex_worker_tasks WHERE dedupe_key=$1 AND status IN ('queued','running') LIMIT 1", [dedupeKey]) : null;
  return { durable: true, id: existing?.rows?.[0]?.id || id };
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
  const r = await db.query(`UPDATE apex_worker_tasks
    SET status='running', attempts=attempts+1,
        lease_owner=$2, lease_token=md5(random()::text || clock_timestamp()::text || $1::text), lease_expires_at=NOW()+($3::double precision * INTERVAL '1 millisecond'),
        updated_at=NOW()
    WHERE id=$1 AND (status='queued' OR (status='running' AND lease_expires_at<NOW()))
      AND attempts < max_attempts AND (next_run_at IS NULL OR next_run_at <= NOW())
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
  const r = await db.query("UPDATE apex_worker_tasks SET status='queued', lease_owner=NULL, lease_token=NULL, lease_expires_at=NULL, updated_at=NOW() WHERE id = ANY($1::uuid[]) AND status='running' AND lease_owner=$2", [taskIds, process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local"]);
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
    recovered_count=recovered_count+1,
    next_run_at=CASE WHEN attempts >= max_attempts THEN NULL ELSE NOW() + ((LEAST(300, POWER(2, attempts)) + (random() * 5)) * INTERVAL '1 second') END,
    last_error='Worker lease expired; task reclaimed', updated_at=NOW()
    FROM x WHERE t.id=x.id RETURNING t.id`, [limit]);
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
