import pg from "pg";
import { randomUUID } from "node:crypto";

const { Pool } = pg;
let pool;

export function durableWorkerEnabled() {
  return Boolean(String(process.env.DATABASE_URL || "").trim());
}

function getPool() {
  if (!durableWorkerEnabled()) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Math.max(5, Math.min(10, Number(process.env.APEX_WORKER_DB_POOL_MAX || 8))),
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      ssl: process.env.APEX_PG_SSL === "false" ? false : { rejectUnauthorized: false }
    });
  }
  return pool;
}

function unwrap(row) {
  if (!row) return null;
  const meta = row.payload && typeof row.payload === "object" ? row.payload._apex_worker || {} : {};
  const payload = row.payload && typeof row.payload === "object" ? row.payload.data ?? row.payload : {};
  return {
    ...row,
    worker_id: row.lease_owner || meta.workerId || null,
    role: meta.role || "general",
    task: row.type,
    payload,
    lease_token: row.lease_token,
    lease_fence: Number(row.lease_fence || 0),
    next_run_at: row.run_at,
    quarantine_reason: row.last_error && row.status === "dead" ? row.last_error : null,
    recovered_count: Number(row.recovered_count || 0)
  };
}

export async function ensureWorkerTaskSchema() {
  if (!durableWorkerEnabled()) return false;
  await getPool().query("SELECT 1 FROM durable_jobs LIMIT 0");
  return true;
}

export async function enqueueWorkerTask({
  id = randomUUID(),
  workerId,
  role,
  task,
  payload = {},
  maxAttempts = 5,
  dedupeKey = null,
  traceId = null,
  priority = 0,
  parentJobId = null
}) {
  if (!durableWorkerEnabled()) return { durable: false, id };
  if (!task) throw new Error("durable worker task requires task");
  const db = getPool();
  const envelope = {
    _apex_worker: {
      workerId: String(workerId || "apex-worker"),
      role: String(role || "general"),
      traceId: traceId ? String(traceId).slice(0, 255) : null
    },
    data: payload && typeof payload === "object" ? payload : {}
  };
  const inserted = await db.query(
    `INSERT INTO durable_jobs
      (id,type,payload,status,run_at,max_attempts,dedupe_key,priority,parent_job_id,created_at,updated_at)
     VALUES ($1,$2,$3::jsonb,'queued',NOW(),$4,$5,$6,$7,NOW(),NOW())
     ON CONFLICT (dedupe_key)
     WHERE dedupe_key IS NOT NULL AND status IN ('queued','running')
     DO NOTHING
     RETURNING id`,
    [
      id, String(task), JSON.stringify(envelope),
      Math.max(1, Number(maxAttempts) || 5),
      dedupeKey, Number(priority) || 0, parentJobId
    ]
  );
  if (inserted.rowCount === 1) return { durable: true, id };
  if (!dedupeKey) return { durable: true, id };
  const existing = await db.query(
    "SELECT id FROM durable_jobs WHERE dedupe_key=$1 AND status IN ('queued','running') ORDER BY updated_at DESC LIMIT 1",
    [dedupeKey]
  );
  return { durable: true, id: existing.rows[0]?.id || id, duplicate: true };
}

export async function claimNextWorkerTasks(limit = 20, leaseMs = 45000, role = null) {
  if (!durableWorkerEnabled()) return [];
  const db = getPool();
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const owner = process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local";
  const r = await db.query(
    `WITH candidate AS (
       SELECT id
       FROM durable_jobs
       WHERE status='queued'
         AND attempts < max_attempts
         AND run_at <= NOW()
         AND (
           $3::text IS NULL OR
           payload->'_apex_worker'->>'role' = $3
         )
       ORDER BY priority DESC, run_at, created_at
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE durable_jobs j
     SET status='running',
         attempts=j.attempts+1,
         lease_owner=$2,
         lease_token=gen_random_uuid(),
         lease_fence=j.lease_fence+1,
         lease_expires_at=NOW()+($4::double precision * INTERVAL '1 millisecond'),
         started_at=COALESCE(j.started_at,NOW()),
         updated_at=NOW()
     FROM candidate
     WHERE j.id=candidate.id
     RETURNING j.*`,
    [safeLimit, owner, role == null ? null : String(role).slice(0, 255), leaseMs]
  );
  return r.rows.map(unwrap);
}

export async function claimNextWorkerTask(leaseMs = 45000) {
  return (await claimNextWorkerTasks(1, leaseMs))[0] || null;
}

export async function claimWorkerTask(id, leaseMs = 45000) {
  if (!durableWorkerEnabled()) return null;
  const db = getPool();
  const owner = process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local";
  const r = await db.query(
    `UPDATE durable_jobs
     SET status='running',
         attempts=attempts+1,
         lease_owner=$2,
         lease_token=gen_random_uuid(),
         lease_fence=lease_fence+1,
         lease_expires_at=NOW()+($3::double precision * INTERVAL '1 millisecond'),
         started_at=COALESCE(started_at,NOW()),
         updated_at=NOW()
     WHERE id=$1
       AND status='queued'
       AND attempts < max_attempts
       AND run_at <= NOW()
     RETURNING *`,
    [id, owner, leaseMs]
  );
  return unwrap(r.rows[0]);
}

export async function heartbeatWorkerTask(id, leaseMs = 45000, leaseToken, leaseFence = null) {
  if (!durableWorkerEnabled()) return false;
  const owner = process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local";
  const params = [id, owner, leaseMs, leaseToken, leaseFence == null ? null : Number(leaseFence)];
  const r = await getPool().query(
    `UPDATE durable_jobs
     SET lease_expires_at=NOW()+($3::double precision * INTERVAL '1 millisecond'), updated_at=NOW()
     WHERE id=$1 AND lease_owner=$2 AND lease_token=$4::uuid AND status='running'
       AND ($5::bigint IS NULL OR lease_fence=$5)`,
    params
  );
  return r.rowCount === 1;
}

export async function completeWorkerTask(id, result = null, leaseToken, leaseFence = null) {
  if (!durableWorkerEnabled()) return false;
  const owner = process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local";
  const r = await getPool().query(
    `UPDATE durable_jobs
     SET status='completed', lease_owner=NULL, lease_token=NULL, lease_expires_at=NULL,
         result=$3::jsonb, completed_at=NOW(), updated_at=NOW()
     WHERE id=$1 AND lease_owner=$2 AND lease_token=$4::uuid AND status='running'
       AND ($5::bigint IS NULL OR lease_fence=$5)`,
    [id, owner, JSON.stringify(result), leaseToken, leaseFence == null ? null : Number(leaseFence)]
  );
  return r.rowCount === 1;
}

export async function failWorkerTask(id, error, leaseToken, leaseFence = null) {
  if (!durableWorkerEnabled()) return false;
  const owner = process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local";
  const message = String(error?.message || error || "Worker task failed").slice(0, 4000);
  const r = await getPool().query(
    `UPDATE durable_jobs
     SET status=CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'queued' END,
         lease_owner=NULL, lease_token=NULL, lease_expires_at=NULL,
         run_at=CASE WHEN attempts >= max_attempts THEN run_at
           ELSE NOW() + ((LEAST(300, POWER(2, attempts)) + random()*5) * INTERVAL '1 second') END,
         last_error=$3, updated_at=NOW()
     WHERE id=$1 AND lease_owner=$2 AND lease_token=$4::uuid AND status='running'
       AND ($5::bigint IS NULL OR lease_fence=$5)`,
    [id, owner, message, leaseToken, leaseFence == null ? null : Number(leaseFence)]
  );
  return r.rowCount === 1;
}

export async function deferWorkerTask(id, delayMs = 1000, reason = "Dependency not ready", leaseToken, leaseFence = null) {
  if (!durableWorkerEnabled()) return false;
  const owner = process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local";
  const safeDelay = Math.max(100, Math.min(300000, Number(delayMs) || 1000));
  const r = await getPool().query(
    `UPDATE durable_jobs
     SET status='queued', lease_owner=NULL, lease_token=NULL, lease_expires_at=NULL,
         run_at=NOW()+($3::double precision * INTERVAL '1 millisecond'),
         last_error=$4, updated_at=NOW()
     WHERE id=$1 AND lease_owner=$2 AND lease_token=$5::uuid AND status='running'
       AND ($6::bigint IS NULL OR lease_fence=$6)`,
    [id, owner, safeDelay, String(reason).slice(0,4000), leaseToken, leaseFence == null ? null : Number(leaseFence)]
  );
  return r.rowCount === 1;
}

export async function quarantineWorkerTask(id, reason, leaseToken, leaseFence = null) {
  return failWorkerTask(id, reason || "QUARANTINED", leaseToken, leaseFence);
}

export async function releaseWorkerTasks(taskIds = [], leaseTokens = []) {
  if (!durableWorkerEnabled() || !taskIds.length) return 0;
  if (leaseTokens.length !== taskIds.length) throw new Error("releaseWorkerTasks requires one lease token per task");
  const owner = process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local";
  const r = await getPool().query(
    `UPDATE durable_jobs j
     SET status='queued', lease_owner=NULL, lease_token=NULL, lease_expires_at=NULL, updated_at=NOW()
     FROM unnest($1::uuid[], $2::uuid[]) AS release(id, token)
     WHERE j.id=release.id AND j.status='running'
       AND j.lease_owner=$3 AND j.lease_token=release.token`,
    [taskIds, leaseTokens, owner]
  );
  return r.rowCount;
}

export async function requeueExpiredWorkerTasks(limit = 500) {
  if (!durableWorkerEnabled()) return 0;
  const safeLimit = Math.max(1, Math.min(5000, Number(limit) || 500));
  const r = await getPool().query(
    `WITH x AS (
       SELECT id, lease_token, lease_fence
       FROM durable_jobs
       WHERE status='running' AND lease_expires_at<NOW()
       ORDER BY lease_expires_at
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE durable_jobs j SET
       status=CASE WHEN j.attempts >= j.max_attempts THEN 'dead' ELSE 'queued' END,
       lease_owner=NULL, lease_token=NULL, lease_expires_at=NULL,
       recovered_count=j.recovered_count+1,
       run_at=CASE WHEN j.attempts >= j.max_attempts THEN j.run_at ELSE NOW()+INTERVAL '1 second' END,
       last_error='Worker lease expired; task reclaimed', updated_at=NOW()
     FROM x
     WHERE j.id=x.id AND j.lease_token=x.lease_token AND j.lease_fence=x.lease_fence
     RETURNING j.id`,
    [safeLimit]
  );
  return r.rowCount;
}

export async function acquireAiRateLimit({ key = "gemini", capacity = 10, refillPerSecond = 10 / 60, retryMs = 300, maxWaitMs = 30000 } = {}) {
  if (!durableWorkerEnabled()) return true;
  const db = getPool();
  const cap = Math.max(1, Number(capacity) || 10);
  const refill = Math.max(0.0001, Number(refillPerSecond) || (10 / 60));
  const wait = Math.max(50, Number(retryMs) || 300);
  const deadline = Date.now() + Math.max(0, Number(maxWaitMs) || 0);
  await db.query(`CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY, tokens DOUBLE PRECISION NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await db.query(`INSERT INTO rate_limits(key,tokens) VALUES($1,$2) ON CONFLICT(key) DO NOTHING`, [key, cap]);
  for (;;) {
    const r = await db.query(
      `UPDATE rate_limits SET
         tokens=LEAST($2, tokens + EXTRACT(EPOCH FROM (NOW()-updated_at))*$3)-1,
         updated_at=NOW()
       WHERE key=$1 AND LEAST($2, tokens + EXTRACT(EPOCH FROM (NOW()-updated_at))*$3)>=1`,
      [key, cap, refill]
    );
    if (r.rowCount === 1) return true;
    if (Date.now() >= deadline) return false;
    await new Promise(resolve => setTimeout(resolve, wait + Math.random() * wait));
  }
}

export async function claimExternalEffect(idempotencyKey) {
  if (!durableWorkerEnabled()) return true;
  const key = String(idempotencyKey || "").trim();
  if (!key) throw new Error("External side effects require an idempotency key");
  const r = await getPool().query(
    `INSERT INTO apex_external_effects(idempotency_key,status)
     VALUES($1,'started') ON CONFLICT(idempotency_key) DO NOTHING RETURNING idempotency_key`,
    [key]
  );
  return r.rowCount === 1;
}

export async function completeExternalEffect(idempotencyKey, result = null) {
  if (!durableWorkerEnabled()) return true;
  const key = String(idempotencyKey || "").trim();
  if (!key) throw new Error("External side effects require an idempotency key");
  const r = await getPool().query(
    `UPDATE apex_external_effects SET status='completed',result=$2::jsonb,updated_at=NOW()
     WHERE idempotency_key=$1 AND status='started'`,
    [key, JSON.stringify(result)]
  );
  return r.rowCount === 1;
}

export async function getWorkerTask(id) {
  if (!durableWorkerEnabled()) return null;
  const r = await getPool().query("SELECT * FROM durable_jobs WHERE id=$1 LIMIT 1", [String(id)]);
  return unwrap(r.rows[0]);
}

export async function queueStats() {
  if (!durableWorkerEnabled()) return { durable: false };
  const r = await getPool().query(`SELECT
    COUNT(*) FILTER(WHERE status='queued')::int queued,
    COUNT(*) FILTER(WHERE status='running')::int running,
    COUNT(*) FILTER(WHERE status='completed')::int completed,
    COUNT(*) FILTER(WHERE status='dead')::int dead,
    COUNT(*)::int total FROM durable_jobs`);
  return { durable: true, ...r.rows[0] };
}

export async function closeWorkerStore() {
  if (pool) await pool.end();
  pool = null;
}

export async function recordWorkerJobEvent(jobId, eventType, payload = {}, workerId = null) {
  if (!durableWorkerEnabled()) return false;
  const r = await getPool().query(
    "INSERT INTO apex_job_events(job_id,event_type,worker_id,payload) VALUES($1,$2,$3,$4::jsonb) RETURNING id",
    [jobId, String(eventType || "unknown").slice(0,120), workerId ? String(workerId).slice(0,255) : null, JSON.stringify(payload)]
  );
  return Boolean(r.rows[0]?.id);
}

export async function registerRenderNode({ id, capabilities = {}, maxConcurrency = 1, state = "ready" }) {
  if (!durableWorkerEnabled()) return false;
  const nodeId = String(id || process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local").slice(0,255);
  await getPool().query(
    `INSERT INTO render_nodes(id,capabilities,max_concurrency,heartbeat_at,state,updated_at)
     VALUES($1,$2::jsonb,$3,NOW(),$4,NOW())
     ON CONFLICT(id) DO UPDATE SET capabilities=$2::jsonb,max_concurrency=$3,heartbeat_at=NOW(),state=$4,updated_at=NOW()`,
    [nodeId,JSON.stringify(capabilities),Math.max(1,Number(maxConcurrency)||1),String(state||"ready")]
  );
  return true;
}

export async function heartbeatRenderNode({ id, inFlight = 0, state = "ready" }) {
  if (!durableWorkerEnabled()) return false;
  const nodeId = String(id || process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local").slice(0,255);
  const r = await getPool().query(
    "UPDATE render_nodes SET in_flight=$2,heartbeat_at=NOW(),state=$3,updated_at=NOW() WHERE id=$1",
    [nodeId,Math.max(0,Number(inFlight)||0),String(state||"ready")]
  );
  return r.rowCount===1;
}

export async function renderCapacitySnapshot() {
  if (!durableWorkerEnabled()) return { durable:false,nodes:[],available:0 };
  const r=await getPool().query(`SELECT id,max_concurrency,in_flight,state,heartbeat_at,
    GREATEST(0,max_concurrency-in_flight) available
    FROM render_nodes WHERE state='ready' ORDER BY available DESC,id`);
  return {durable:true,nodes:r.rows,available:r.rows.reduce((s,x)=>s+Number(x.available||0),0)};
}
