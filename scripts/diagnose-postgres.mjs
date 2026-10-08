#!/usr/bin/env node
import pg from "pg";
const { Pool } = pg;
const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: Math.max(1000, Number(process.env.APEX_PG_CONNECTION_TIMEOUT_MS || 5000)),
  idleTimeoutMillis: 5000,
  ssl: process.env.APEX_PG_SSL === "false" ? false : { rejectUnauthorized: false }
});
const targets = ["durable_jobs","apex_job_events","rate_limits","apex_external_effects","render_nodes","apex_projects","production_jobs","production_events"];
try {
  const version = await pool.query("SELECT current_database() AS database, version() AS version");
  const dbSize = await pool.query("SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size");
  const tables = await pool.query(
    "SELECT n.nspname AS schema_name, c.relname AS table_name, " +
    "pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size, " +
    "pg_total_relation_size(c.oid) AS total_bytes, " +
    "CASE WHEN c.reltuples < 0 THEN NULL ELSE c.reltuples::bigint END AS estimated_rows " +
    "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
    "WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog','information_schema') " +
    "AND c.relname = ANY($1) ORDER BY pg_total_relation_size(c.oid) DESC",
    [targets]
  );
  const counts = {};
  for (const table of targets) {
    try {
      const result = await pool.query("SELECT COUNT(*)::bigint AS count FROM " + table);
      counts[table] = Number(result.rows[0].count);
    } catch (error) {
      counts[table] = { unavailable: error.message };
    }
  }
  console.log(JSON.stringify({
    status: "diagnostic-only",
    database: version.rows[0].database,
    databaseSize: dbSize.rows[0].database_size,
    tables: tables.rows,
    counts
  }, null, 2));
} finally {
  await pool.end();
}
