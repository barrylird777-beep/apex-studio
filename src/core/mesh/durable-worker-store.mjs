import { APEX_LIMITS } from "./apex-limits.mjs";
import pg from "pg";

const { Pool } = pg;
let pool;

export function durableWorkerEnabled() {
  return Boolean(String(process.env.DATABASE_URL || "").trim());
}

function getPool() {
  if (!durableWorkerEnabled()) return null;
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Math.max(5, APEX_LIMITS.WORKER.DB_POOL_MAX, Number(process.env.APEX_WORKER_DB_POOL_MAX || APEX_LIMITS.WORKER.DB_POOL_DEFAULT))) });
  return pool;
}

export async function ensureWorkerTaskSchema() {
  if (!durableWorkerEnabled()) return false;
  await getPool().query("SELECT 1 FROM apex_worker_tasks LIMIT 0");
  return true;
}

export async function enqueueWorkerTask({ id, workerId, role, task, payload = {}, maxAttempts = 5, dedupeKey = null, traceId = null }) {
  if (!durableWorkerEnabled()) return { durable: false, id };
  const db = getPool();
  await db.query(`INSERT INTO apex_worker_tasks
    (id, worker_id, role, task, payload, max_attempts, dedupe_key, trace_id)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
    ON CONFLICT DO NOTHING`,
    [id, String(workerId), String(role || "general"), String(task || ""), JSON.stringify(payload), Math.max(1, Number(maxAttempts) || 5), dedupeKey, traceId ? String(traceId).slice(0,255) : null]);
  const existing = dedupeKey ? await db.query("SELECT id FROM apex_worker_tasks WHERE dedupe_key=$1 AND status IN ('queued','running') LIMIT 1", [dedupeKey]) : null;
  return { durable: true, id: existing?.rows?.[0]?.id || id };
}

export async function claimNextWorkerTasks(limit = 20, leaseMs = 45000, role = null) {
  if (!durableWorkerEnabled()) return [];
  const db = getPool();
  const safeLimit = Math.max(1, APEX_LIMITS.WORKER.MAX_BATCH_SIZE, Number(limit) || APEX_LIMITS.WORKER.BATCH_SIZE));
  const safeRole = role == null ? null : String(role).slice(0, 255);
  const r = await db.query(`WITH candidate AS (
    SELECT id FROM apex_worker_tasks
    WHERE status='queued'
      AND attempts < max_attempts
      AND (next_run_at IS NULL OR next_run_at <= NOW())
      AND ($3::text IS NULL OR role=$3)
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT $1
  ) UPDATE apex_worker_tasks t
    SET status='running', attempts=attempts+1,
        lease_owner=$2, lease_token=gen_random_uuid()::text, last_worker_pid=$5, lease_expires_at=NOW()+($4::double precision * INTERVAL '1 millisecond'),
        updated_at=NOW()
    FROM candidate
    WHERE t.id=candidate.id
    RETURNING t.*`,
    [safeLimit, process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local", safeRole, leaseMs, process.pid]);
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
        lease_owner=$2, lease_token=gen_random_uuid()::text, last_worker_pid=$4, lease_expires_at=NOW()+($3::double precision * INTERVAL '1 millisecond'),
        updated_at=NOW()
    WHERE id=$1 AND (status='queued' OR (status='running' AND lease_expires_at<NOW()))
      AND attempts < max_attempts AND (next_run_at IS NULL OR next_run_at <= NOW())
    RETURNING *`, [id, process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local", leaseMs, process.pid]);
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
        last_error=$3, quarantine_reason=CASE WHEN attempts >= max_attempts THEN 'MAX_ATTEMPTS_EXHAUSTED' ELSE quarantine_reason END, updated_at=NOW()
    WHERE id=$1 AND lease_owner=$2 AND lease_token=$4 AND status='running'`,
    [id, process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local", message, leaseToken]);
  return r.rowCount === 1;
}

export async function deferWorkerTask(id, delayMs = 1000, reason = "Dependency not ready", leaseToken) {
  if (!durableWorkerEnabled()) return false;
  const safeDelay = Math.max(100, Math.min(300000, Number(delayMs) || 1000));
  const r = await getPool().query(`UPDATE apex_worker_tasks
    SET status='queued', lease_owner=NULL, lease_token=NULL, lease_expires_at=NULL,
        next_run_at=NOW()+($3::double precision * INTERVAL '1 millisecond'),
        last_error=$4, updated_at=NOW()
    WHERE id=$1 AND lease_owner=$2 AND lease_token=$5 AND status='running'`,
    [id, process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local", safeDelay, String(reason).slice(0,4000), leaseToken]);
  return r.rowCount === 1;
}

export async function quarantineWorkerTask(id, reason, leaseToken) {
  if (!durableWorkerEnabled()) return false;
  const owner = process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local";
  const r = await getPool().query(
    "UPDATE apex_worker_tasks SET status='failed', quarantine_reason=$3, last_error=$3, lease_owner=NULL, lease_token=NULL, lease_expires_at=NULL, updated_at=NOW() WHERE id=$1 AND lease_owner=$2 AND lease_token=$4 AND status='running'",
    [id, owner, String(reason || "QUARANTINED").slice(0,4000), leaseToken]
  );
  return r.rowCount === 1;
}

export async function releaseWorkerTasks(taskIds = [], leaseTokens = []) {
  if (!durableWorkerEnabled() || !taskIds.length) return 0;
  if (leaseTokens.length !== taskIds.length) throw new Error("releaseWorkerTasks requires one lease token per task");
  const owner = process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local";
  const r = await getPool().query(`UPDATE apex_worker_tasks t
    SET status='queued', lease_owner=NULL, lease_token=NULL, lease_expires_at=NULL, updated_at=NOW()
    FROM unnest($1::uuid[], $2::text[]) AS release(id, token)
    WHERE t.id=release.id AND t.status='running' AND t.lease_owner=$3 AND t.lease_token=release.token`,
    [taskIds, leaseTokens, owner]);
  return r.rowCount;
}

export async function requeueExpiredWorkerTasks(limit = 500) {
  if (!durableWorkerEnabled()) return 0;
  const safeLimit = Math.max(1, Math.min(5000, Number(limit) || 500));
  const r = await getPool().query(`WITH x AS (
    SELECT id FROM apex_worker_tasks
    WHERE status='running' AND lease_expires_at<NOW()
    ORDER BY lease_expires_at
    FOR UPDATE SKIP LOCKED
    LIMIT $1
  ) UPDATE apex_worker_tasks t SET
    status=CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
    lease_owner=NULL, lease_token=NULL, lease_expires_at=NULL,
    recovered_count=recovered_count+1,
    next_run_at=CASE WHEN attempts >= max_attempts THEN NULL ELSE NOW() + ((LEAST(300, POWER(2, attempts)) + (random() * 5)) * INTERVAL '1 second') END,
    last_error='Worker lease expired; task reclaimed', quarantine_reason=CASE WHEN attempts >= max_attempts THEN 'LEASE_EXPIRY_MAX_ATTEMPTS' ELSE quarantine_reason END, updated_at=NOW()
    FROM x WHERE t.id=x.id RETURNING t.id`, [safeLimit]);
  return r.rowCount;
}

export async function acquireAiRateLimit({ key = "gemini", capacity = 10, refillPerSecond = 10 / 60, retryMs = 300, maxWaitMs = 30000 } = {}) {
  if (!durableWorkerEnabled()) return true;
  const db = getPool();
  const cap = Math.max(1, Number(capacity) || 10);
  const refill = Math.max(0.0001, Number(refillPerSecond) || (10 / 60));
  const wait = Math.max(50, Number(retryMs) || 300);
  const deadline = Date.now() + Math.max(0, Number(maxWaitMs) || 0);
  await db.query(`INSERT INTO rate_limits (key, tokens, updated_at)
    VALUES ($1, $2, NOW()) ON CONFLICT (key) DO NOTHING`, [key, cap]);

  while (Date.now() < deadline) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const row = await client.query(
        "SELECT tokens, updated_at FROM rate_limits WHERE key=$1 FOR UPDATE",
        [key]
      );
      const current = row.rows[0];
      if (!current) throw new Error(`Rate-limit bucket missing: ${key}`);
      const elapsed = Math.max(0, (Date.now() - new Date(current.updated_at).getTime()) / 1000);
      const available = Math.min(cap, Number(current.tokens) + elapsed * refill);
      if (available >= 1) {
        await client.query(
          "UPDATE rate_limits SET tokens=$2, updated_at=NOW() WHERE key=$1",
          [key, available - 1]
        );
        await client.query("COMMIT");
        return true;
      }
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    const remaining = Math.max(0, deadline - Date.now());
    if (!remaining) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(wait + Math.floor(Math.random() * wait), remaining)));
  }
  return false;
}

export async function claimExternalEffect(idempotencyKey) {
  if (!durableWorkerEnabled()) return true;
  const key = String(idempotencyKey || "").trim();
  if (!key) throw new Error("External side effects require an idempotency key");
  const r = await getPool().query(`INSERT INTO apex_external_effects (idempotency_key, status)
     VALUES ($1, 'started') ON CONFLICT (idempotency_key) DO NOTHING RETURNING idempotency_key`, [key]);
  return r.rowCount === 1;
}

export async function completeExternalEffect(idempotencyKey, result = null) {
  if (!durableWorkerEnabled()) return true;
  const key = String(idempotencyKey || "").trim();
  if (!key) throw new Error("External side effects require an idempotency key");
  const r = await getPool().query(`UPDATE apex_external_effects SET status='completed', result=$2::jsonb, updated_at=NOW()
     WHERE idempotency_key=$1 AND status='started'`, [key, JSON.stringify(result)]);
  return r.rowCount === 1;
}

export async function queueStats() {
  if (!durableWorkerEnabled()) return { durable: false };
  const r = await getPool().query(`SELECT COUNT(*) FILTER (WHERE status='queued')::int AS queued,
    COUNT(*) FILTER (WHERE status='running')::int AS running,
    COUNT(*) FILTER (WHERE status='completed')::int AS completed,
    COUNT(*) FILTER (WHERE status='failed')::int AS failed,
    COUNT(*)::int AS total FROM apex_worker_tasks`);
  return { durable: true, ...r.rows[0] };
}

export async function closeWorkerStore() {
  if (pool) await pool.end();
  pool = null;
}
