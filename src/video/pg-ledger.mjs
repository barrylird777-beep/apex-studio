export const LEDGER_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS video_provenance (
  id bigserial PRIMARY KEY,
  ts timestamptz NOT NULL,
  entry jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS video_provenance_run_idx ON video_provenance ((entry->>'run'));
CREATE OR REPLACE FUNCTION video_provenance_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'video_provenance is append-only'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS video_provenance_rows ON video_provenance;
CREATE TRIGGER video_provenance_rows BEFORE UPDATE OR DELETE ON video_provenance FOR EACH ROW EXECUTE FUNCTION video_provenance_append_only();
DROP TRIGGER IF EXISTS video_provenance_truncate ON video_provenance;
CREATE TRIGGER video_provenance_truncate BEFORE TRUNCATE ON video_provenance FOR EACH STATEMENT EXECUTE FUNCTION video_provenance_append_only();
`;

export function createPgLedger(db) {
  return {
    async record(entry) {
      await db.query('INSERT INTO video_provenance (ts, entry) VALUES ($1, $2::jsonb)', [new Date().toISOString(), JSON.stringify(entry)]);
    },
    async read() {
      const r = await db.query('SELECT ts, entry FROM video_provenance ORDER BY id');
      return r.rows.map((x) => ({ ts: x.ts instanceof Date ? x.ts.toISOString() : x.ts, ...x.entry }));
    },
  };
}
