import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for the Apexus buyer-readiness audit");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  connectionTimeoutMillis: 10000,
  ssl: process.env.APEX_PG_SSL === "false" ? false : { rejectUnauthorized: false }
});

const REQUIRED_EPISODES = 2785;

try {
  const [episodes, catalog, scheduled, assets, broken] = await Promise.all([
    pool.query("SELECT COUNT(*)::int AS count FROM apexus_episodes"),
    pool.query("SELECT COUNT(*)::int AS count FROM apexus_catalog"),
    pool.query("SELECT COUNT(*)::int AS count FROM apexus_schedule WHERE status='scheduled'"),
    pool.query("SELECT COUNT(DISTINCT episode_id)::int AS count FROM apexus_episode_assets"),
    pool.query(`
      SELECT e.episode_code
      FROM apexus_episodes e
      LEFT JOIN apexus_catalog c ON c.episode_id=e.id
      LEFT JOIN apexus_schedule s ON s.episode_id=e.id AND s.status='scheduled'
      WHERE c.episode_id IS NULL OR s.episode_id IS NULL
      ORDER BY e.episode_code
      LIMIT 25
    `)
  ]);

  const report = {
    product: "Apexus",
    targetEpisodeCount: REQUIRED_EPISODES,
    episodeCount: episodes.rows[0].count,
    catalogCount: catalog.rows[0].count,
    scheduledCount: scheduled.rows[0].count,
    episodesWithAssets: assets.rows[0].count,
    incompleteSample: broken.rows.map(row => row.episode_code),
    buyerReady: episodes.rows[0].count === REQUIRED_EPISODES &&
      catalog.rows[0].count === REQUIRED_EPISODES &&
      scheduled.rows[0].count === REQUIRED_EPISODES &&
      broken.rowCount === 0
  };

  console.log(JSON.stringify(report, null, 2));
  if (!report.buyerReady) process.exitCode = 2;
} finally {
  await pool.end();
}
