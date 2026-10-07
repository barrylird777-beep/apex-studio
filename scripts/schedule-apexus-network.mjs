import pg from "pg";
import { buildNetworkSchedule } from "../src/core/apexus-network-scheduler.mjs";

const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  ssl: process.env.APEX_PG_SSL === "false" ? false : { rejectUnauthorized: false }
});

const horizonMinutes = Number(process.env.APEXUS_SCHEDULE_MINUTES || 1440);
const start = process.env.APEXUS_SCHEDULE_START ? new Date(process.env.APEXUS_SCHEDULE_START) : new Date();

try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT e.id,e.episode_code,e.audience_lane,e.runtime_target_seconds
       FROM apexus_catalog c
       JOIN apexus_episodes e ON e.id=c.episode_id
       WHERE c.qc_passed_at IS NOT NULL
       ORDER BY e.global_episode_number`
    );
    if (!result.rowCount) throw new Error("No QC-passed catalog episodes are available");
    const rows = buildNetworkSchedule({ episodes: result.rows, startAt: start, horizonMinutes });
    await client.query("DELETE FROM apexus_schedule WHERE starts_at >= $1 AND starts_at < $2 AND status='scheduled'", [
      start, new Date(start.getTime() + horizonMinutes * 60000)
    ]);
    for (const row of rows) {
      await client.query(
        `INSERT INTO apexus_schedule(id,episode_id,starts_at,ends_at,block_name,status)
         VALUES($1,$2,$3,$4,$5,'scheduled')`,
        [row.id,row.episodeId,row.startsAt,row.endsAt,row.blockName]
      );
    }
    await client.query("COMMIT");
    console.log(JSON.stringify({status:"ok",scheduled:rows.length,start:start.toISOString(),horizonMinutes}));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
} finally { await pool.end(); }
