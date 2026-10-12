import pg from "pg";
import { randomUUID } from "node:crypto";

const { Pool } = pg;
let pool;

function enabled() {
  return Boolean(String(process.env.DATABASE_URL || "").trim());
}

function sslConfig() {
  const explicit = String(process.env.APEX_PG_SSL || "").trim().toLowerCase();
  if (explicit === "false" || explicit === "0") return false;
  if (explicit === "true" || explicit === "1") return { rejectUnauthorized: false };
  try {
    const host = new URL(process.env.DATABASE_URL).hostname;
    return ["localhost", "127.0.0.1", "::1"].includes(host) ? false : { rejectUnauthorized: false };
  } catch {
    return false;
  }
}

function db() {
  if (!enabled()) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Math.max(2, Math.min(5, Number(process.env.APEX_CHAT_RUNTIME_DB_POOL_MAX || 3))),
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      ssl: sslConfig()
    });
  }
  return pool;
}

function cleanText(value, max = 10000) {
  return String(value ?? "").trim().slice(0, max);
}

function json(value, fallback = {}) {
  return value && typeof value === "object" ? value : fallback;
}

const EMPTY_STATE = Object.freeze({
  mission: null,
  activeWork: [],
  blockers: [],
  decisions: [],
  verifiedFacts: [],
  pendingVerification: [],
  recovery: null,
  metadata: {}
});

export async function getChatRuntimeState(scope = "default") {
  if (!enabled()) return { durable: false, scope, state: { ...EMPTY_STATE } };
  const result = await db().query(
    "SELECT scope, state, version, updated_at FROM apex_chat_runtime_state WHERE scope=$1",
    [cleanText(scope, 255) || "default"]
  );
  if (!result.rowCount) {
    return { durable: true, scope, state: { ...EMPTY_STATE }, version: 0, updatedAt: null };
  }
  const row = result.rows[0];
  return {
    durable: true,
    scope: row.scope,
    state: { ...EMPTY_STATE, ...json(row.state) },
    version: Number(row.version),
    updatedAt: row.updated_at
  };
}

export async function updateChatRuntimeState({
  scope = "default",
  patch = {},
  expectedVersion = null,
  actor = "engine-apex"
} = {}) {
  if (!enabled()) return { durable: false, scope, state: { ...EMPTY_STATE, ...json(patch) }, version: 0 };
  const key = cleanText(scope, 255) || "default";
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      "SELECT state, version FROM apex_chat_runtime_state WHERE scope=$1 FOR UPDATE",
      [key]
    );
    const currentState = current.rowCount ? { ...EMPTY_STATE, ...json(current.rows[0].state) } : { ...EMPTY_STATE };
    const currentVersion = current.rowCount ? Number(current.rows[0].version) : 0;
    if (expectedVersion != null && Number(expectedVersion) !== currentVersion) {
      const error = new Error("Chat runtime state version conflict");
      error.code = "RUNTIME_VERSION_CONFLICT";
      error.currentVersion = currentVersion;
      throw error;
    }
    const nextState = { ...currentState, ...json(patch) };
    const nextVersion = currentVersion + 1;
    await client.query(
      `INSERT INTO apex_chat_runtime_state(scope,state,version,updated_at)
       VALUES($1,$2::jsonb,$3,NOW())
       ON CONFLICT(scope) DO UPDATE
       SET state=EXCLUDED.state, version=EXCLUDED.version, updated_at=NOW()`,
      [key, JSON.stringify(nextState), nextVersion]
    );
    await client.query(
      "INSERT INTO apex_chat_runtime_events(id,scope,event_type,payload,actor) VALUES($1,$2,$3,$4::jsonb,$5)",
      [randomUUID(), key, "state.updated", JSON.stringify({ patch: json(patch), version: nextVersion }), cleanText(actor, 255) || "engine-apex"]
    );
    await client.query("COMMIT");
    return { durable: true, scope: key, state: nextState, version: nextVersion };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function recordChatRuntimeEvent({
  scope = "default",
  eventType = "runtime.event",
  payload = {},
  actor = "engine-apex"
} = {}) {
  if (!enabled()) return { durable: false, id: randomUUID() };
  const id = randomUUID();
  await db().query(
    "INSERT INTO apex_chat_runtime_events(id,scope,event_type,payload,actor) VALUES($1,$2,$3,$4::jsonb,$5)",
    [id, cleanText(scope, 255) || "default", cleanText(eventType, 120) || "runtime.event", JSON.stringify(json(payload)), cleanText(actor, 255) || "engine-apex"]
  );
  return { durable: true, id };
}

export async function listChatRuntimeEvents(scope = "default", limit = 50) {
  if (!enabled()) return { durable: false, events: [] };
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 50));
  const result = await db().query(
    "SELECT id,scope,event_type,payload,actor,created_at FROM apex_chat_runtime_events WHERE scope=$1 ORDER BY created_at DESC LIMIT $2",
    [cleanText(scope, 255) || "default", safeLimit]
  );
  return { durable: true, events: result.rows };
}

export async function closeChatRuntimeStore() {
  if (pool) await pool.end();
  pool = null;
}
