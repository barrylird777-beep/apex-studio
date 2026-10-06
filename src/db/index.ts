import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required; Apex Studio no longer supports SQLite.");
}

export const pool = new Pool({
  connectionString,
  max: Number(process.env.APEX_DB_POOL_MAX || 20),
  idleTimeoutMillis: Number(process.env.APEX_DB_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.APEX_DB_CONNECTION_TIMEOUT_MS || 10000),
});

export const db = drizzle(pool, { schema });

export async function closeDb() {
  await pool.end();
}
