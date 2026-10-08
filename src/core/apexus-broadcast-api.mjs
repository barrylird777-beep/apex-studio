import pg from "pg";
import { broadcastStatus } from "./apexus-broadcast-controller.mjs";

const { Pool } = pg;
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  connectionTimeoutMillis: 5000,
  ssl: process.env.APEX_PG_SSL === "false" ? false : { rejectUnauthorized: false }
}) : null;

export async function getApexusBroadcastStatus(now = new Date()) {
  if (!pool) throw new Error("DATABASE_URL is required for Apexus broadcast status");
  const [schedule, catalog] = await Promise.all([
    pool.query(
      'SELECT s.id,s.episode_id,e.episode_code,e.title,e.audience_lane,s.block_name,s.starts_at,s.ends_at,s.status FROM apexus_schedule s JOIN apexus_episodes e ON e.id=s.episode_id WHERE s.status=''scheduled'' AND s.ends_at >= $1 ORDER BY s.starts_at ASC LIMIT 50',
      [now]
    ),
    pool.query('SELECT COUNT(*)::int AS count FROM apexus_catalog')
  ]);
  return {
    network: "Apexus",
    mode: "scheduled",
    catalogEpisodes: catalog.rows[0]?.count || 0,
    ...broadcastStatus({ rows: schedule.rows, now }),
    checkedAt: new Date().toISOString()
  };
}

export async function closeApexusBroadcastStatusPool() {
  if (pool) await pool.end();
}
