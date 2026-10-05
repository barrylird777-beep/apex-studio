#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const { Pool } = pg;
const root = path.resolve('drizzle-pg');
const manifestPath = path.resolve('scripts/postgres-migration-manifest.json');
const databaseUrl = String(process.env.DATABASE_URL || '').trim();

if (!databaseUrl) throw new Error('DATABASE_URL is required for PostgreSQL migrations');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const entries = Array.isArray(manifest.migrations) ? manifest.migrations : [];
if (!entries.length) throw new Error('PostgreSQL migration journal is empty');

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  idleTimeoutMillis: Number(process.env.APEX_DB_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.APEX_DB_CONNECTION_TIMEOUT_MS || 10000),
});

const digest = (sql) => createHash('sha256').update(sql).digest('hex');

try {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS apex_schema_migrations (
        idx INTEGER PRIMARY KEY,
        tag TEXT NOT NULL UNIQUE,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const entry of entries) {
      const file = path.join(root, entry.tag + '.sql');
      const sql = await readFile(file, 'utf8');
      const checksum = digest(sql);

      await client.query('BEGIN');
      try {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('apex:schema-migrations', 0))");

        const existing = await client.query(
          'SELECT idx, tag, checksum FROM apex_schema_migrations WHERE idx = $1',
          [entry.idx],
        );

        if (existing.rowCount) {
          const row = existing.rows[0];
          if (row.tag !== entry.tag || row.checksum !== checksum) {
            throw new Error(
              `migration checksum mismatch for idx ${entry.idx}: database has ${row.tag}/${row.checksum}, repository has ${entry.tag}/${checksum}`,
            );
          }
        } else {
          await client.query(sql);
          await client.query(
            'INSERT INTO apex_schema_migrations (idx, tag, checksum) VALUES ($1, $2, $3)',
            [entry.idx, entry.tag, checksum],
          );
          console.log(`applied ${entry.idx}: ${entry.tag}`);
        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
    }
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
