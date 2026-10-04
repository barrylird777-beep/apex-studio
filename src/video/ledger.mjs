import { appendFile, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const { Pool } = pg;

export function createFileLedger(file) {
  return {
    async record(entry) {
      await mkdir(path.dirname(file), { recursive: true });
      await appendFile(file, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
    },
    async read() {
      try {
        const text = await readFile(file, 'utf8');
        return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
    },
  };
}

export function createMemoryLedger() {
  const rows = [];
  return {
    async record(entry) {
      rows.push({ ts: new Date().toISOString(), ...entry });
    },
    async read() {
      return rows.map((row) => ({ ...row }));
    },
  };
}

export function createPostgresLedger({ pool = null, closePool = true } = {}) {
  const db = pool ?? (String(process.env.DATABASE_URL || '').trim()
    ? new Pool({ connectionString: process.env.DATABASE_URL, max: 2 })
    : null);
  if (!db) throw new Error('PostgreSQL ledger requires DATABASE_URL or an injected pool');

  return {
    async record(entry) {
      const {
        run, kind, status, id, shot, path: artifactPath, sha256, model, voice,
        labels, sources, spec, metadata, ...extra
      } = entry;
      await db.query(
        `INSERT INTO asset_provenance
          (run_id, kind, status, artifact_id, shot, path, sha256, model, voice, labels, sources, spec, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb)`,
        [
          run, kind, status, id ?? null, shot ?? null, artifactPath ?? null, sha256 ?? null,
          model ?? null, voice ?? null, JSON.stringify(labels ?? []), JSON.stringify(sources ?? []),
          JSON.stringify(spec ?? null), JSON.stringify({ ...(metadata ?? {}), ...extra }),
        ],
      );
    },
    async read(runId = null) {
      const result = await db.query(
        `SELECT run_id AS run, kind, status, artifact_id AS id, shot, path, sha256, model, voice,
                labels, sources, spec, metadata, created_at AS ts
           FROM asset_provenance
          WHERE ($1::uuid IS NULL OR run_id = $1::uuid)
          ORDER BY created_at, id`,
        [runId],
      );
      return result.rows;
    },
    async close() {
      if (closePool && typeof db.end === 'function') await db.end();
    },
  };
}
