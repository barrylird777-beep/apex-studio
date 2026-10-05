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

const root = path.dirname(fileURLToPath(new URL("../", import.meta.url)));
const dir = path.join(root, "postgres", "migrations");
const pool = new Pool({ connectionString: url });

try {
  await pool.query(`CREATE TABLE IF NOT EXISTS apex_schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  const files = (await fs.readdir(dir))
    .filter(name => /^\\d+_.+\\.sql$/.test(name))
    .sort();
  for (const file of files) {
    const version = file.split("_", 1)[0];
    const exists = await pool.query("SELECT 1 FROM apex_schema_migrations WHERE version=$1", [version]);
    if (exists.rowCount) continue;
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
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
