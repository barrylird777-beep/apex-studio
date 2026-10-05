import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { APEX_LIMITS } from "../core/mesh/apex-limits.mjs";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required; Apex Studio uses PostgreSQL as its durable authority.");
}

const requestedPoolMax = Number(process.env.APEX_DB_POOL_MAX || APEX_LIMITS.WORKER.DB_POOL_DEFAULT);
const poolMax = Math.max(5, Math.min(APEX_LIMITS.WORKER.DB_POOL_MAX, Number.isFinite(requestedPoolMax) ? requestedPoolMax : APEX_LIMITS.WORKER.DB_POOL_DEFAULT));

export const pool = new Pool({
  connectionString,
  max: poolMax,
  idleTimeoutMillis: Number(process.env.APEX_DB_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.APEX_DB_CONNECTION_TIMEOUT_MS || 10000),
});

export const db = drizzle(pool, { schema });

export async function closeDb() {
  await pool.end();
}
