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
  await getPool().query("SELECT 1");
  return true;
}

export async function queueStats() {
  return { durable: durableWorkerEnabled() };
}

export async function closeWorkerStore() {
  if (pool) await pool.end();
  pool = null;
}
