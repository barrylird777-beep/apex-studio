import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const url = String(process.env.DATABASE_URL || "").trim();
if (!url) {
  console.error("DATABASE_URL is required for PostgreSQL migrations.");
  process.exit(2);
}

const root = fileURLToPath(new URL("../", import.meta.url));
const dir = path.join(root, "postgres", "migrations");
let databaseHost = "";
try { databaseHost = new URL(url).hostname; } catch {}
const isLocalDatabase = databaseHost === "localhost" || databaseHost === "127.0.0.1" || databaseHost === "::1";
const sslSetting = process.env.APEX_PG_SSL === "false" || isLocalDatabase
  ? false
  : { rejectUnauthorized: false };
const pool = new Pool({
  connectionString: url,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  ssl: sslSetting
});

async function runMigrationFile(file) {
  const version = file.split("_", 1)[0];
  const exists = await pool.query("SELECT 1 FROM apex_schema_migrations WHERE version=$1", [version]);
  if (exists.rowCount) return;

  const sql = await fs.readFile(path.join(dir, file), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO apex_schema_migrations(version) VALUES($1)", [version]);
    await client.query("COMMIT");
    console.log(`applied PostgreSQL migration ${file}`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw new Error(`migration ${file} failed: ${error?.message || error}`);
  } finally {
    client.release();
  }
}

try {
  // The migration ledger must exist before any application table is assumed.
  await pool.query(`CREATE TABLE IF NOT EXISTS apex_schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  const files = (await fs.readdir(dir))
    .filter(name => /^\d+_.+\.sql$/.test(name))
    .sort();

  for (const file of files) await runMigrationFile(file);

  // Post-migration compatibility/hardening. These statements are intentionally
  // after the migration files so a fresh database can bootstrap from zero.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS apex_projects (
      id UUID PRIMARY KEY,
      owner_id TEXT NOT NULL,
      state JSONB NOT NULL DEFAULT '{}'::jsonb,
      version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS apex_projects_owner_idx
      ON apex_projects(owner_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS render_nodes (
      id TEXT PRIMARY KEY,
      capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
      max_concurrency INTEGER NOT NULL DEFAULT 1 CHECK (max_concurrency >= 1),
      in_flight INTEGER NOT NULL DEFAULT 0 CHECK (in_flight >= 0),
      heartbeat_at TIMESTAMPTZ,
      state TEXT NOT NULL DEFAULT 'ready'
        CHECK (state IN ('ready','draining','offline')),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS render_nodes_capacity_idx
      ON render_nodes(state, in_flight, max_concurrency);

    CREATE TABLE IF NOT EXISTS apex_job_events (
      id BIGSERIAL PRIMARY KEY,
      job_id UUID NOT NULL,
      event_type TEXT NOT NULL,
      worker_id TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS apex_job_events_job_idx
      ON apex_job_events(job_id, created_at);

    ALTER TABLE durable_jobs
      ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS parent_job_id UUID;

    CREATE INDEX IF NOT EXISTS durable_jobs_priority_claim_idx
      ON durable_jobs(status, priority DESC, run_at, created_at);

    CREATE TABLE IF NOT EXISTS apex_external_effects (
      idempotency_key TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('started','completed')),
      result JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF to_regclass('public.apex_worker_tasks') IS NOT NULL THEN
        ALTER TABLE apex_worker_tasks
          ADD COLUMN IF NOT EXISTS dedupe_key TEXT,
          ADD COLUMN IF NOT EXISTS trace_id TEXT,
          ADD COLUMN IF NOT EXISTS last_worker_pid INTEGER,
          ADD COLUMN IF NOT EXISTS quarantine_reason TEXT,
          ADD COLUMN IF NOT EXISTS recovered_count INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE apex_worker_tasks
          DROP CONSTRAINT IF EXISTS apex_worker_tasks_recovered_count_check;
        ALTER TABLE apex_worker_tasks
          ADD CONSTRAINT apex_worker_tasks_recovered_count_check
          CHECK (recovered_count >= 0);
        CREATE UNIQUE INDEX IF NOT EXISTS apex_worker_tasks_dedupe_idx
          ON apex_worker_tasks(dedupe_key)
          WHERE dedupe_key IS NOT NULL AND status IN ('queued','running');
        CREATE INDEX IF NOT EXISTS apex_worker_tasks_trace_idx
          ON apex_worker_tasks(trace_id)
          WHERE trace_id IS NOT NULL;
      END IF;
    END
    $$;
  `);

  console.log("PostgreSQL migrations complete.");
} catch (error) {
  console.error("[migrate-postgres] fatal:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
