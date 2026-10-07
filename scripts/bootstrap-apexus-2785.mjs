import pg from "pg";
import { buildInitialProductionBatch } from "../src/core/apexus-production.mjs";

const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  connectionTimeoutMillis: 10000,
  ssl: process.env.APEX_PG_SSL === "false" ? false : { rejectUnauthorized: false }
});

const client = await pool.connect();
try {
  await client.query("BEGIN");
  const episodes = buildInitialProductionBatch();
  for (const episode of episodes) {
    await client.query(
      `INSERT INTO apexus_episodes
        (id, global_episode_number, episode_code, series_id, season_id, episode_number,
         title, logline, audience_lane, maturity_rating, visual_style, runtime_target_seconds,
         state, creative_brief, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'IDEA',$13::jsonb,$14::jsonb)
       ON CONFLICT (global_episode_number) DO NOTHING`,
      [
        episode.id, episode.globalEpisodeNumber, episode.episodeCode, episode.seriesId,
        episode.seasonId, episode.episodeNumber, episode.title, episode.logline,
        episode.audienceLane, episode.maturityRating, episode.visualStyle,
        episode.runtimeTargetSeconds, JSON.stringify(episode.creativeBrief),
        JSON.stringify(episode.metadata)
      ]
    );
  }
  await client.query("COMMIT");
  const result = await pool.query("SELECT COUNT(*)::int AS count FROM apexus_episodes");
  await client.query(
    `INSERT INTO durable_jobs
      (id,type,payload,status,run_at,max_attempts,dedupe_key,priority,created_at,updated_at)
     SELECT gen_random_uuid(),'apexus.episode.story',
            jsonb_build_object('episodeId',e.id,'episodeCode',e.episode_code,'stage','story'),
            'queued',NOW(),8,'apexus:'||e.episode_code||':story',1000,NOW(),NOW()
     FROM apexus_episodes e
     WHERE e.state='IDEA'
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued','running') DO NOTHING`
  );
  const queued = await pool.query(`SELECT COUNT(*)::int AS count FROM durable_jobs WHERE type='apexus.episode.story' AND status='queued'`);
  console.log(JSON.stringify({
    status: "ok",
    network: "Apexus",
    episodeCount: result.rows[0].count,
    storyJobsQueued: queued.rows[0].count,
    first: "APX-0001",
    last: "APX-2785"
  }));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
