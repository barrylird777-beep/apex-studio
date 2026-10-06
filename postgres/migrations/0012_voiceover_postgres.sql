-- PostgreSQL voiceover queue. Replaces the legacy SQLite voiceover_jobs store.
CREATE TABLE IF NOT EXISTS voiceover_jobs (
  id UUID PRIMARY KEY,
  text TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'auto',
  voice TEXT,
  language TEXT,
  speed REAL NOT NULL DEFAULT 1,
  pitch REAL NOT NULL DEFAULT 0,
  format TEXT NOT NULL DEFAULT 'wav',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  priority INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  output_path TEXT,
  bytes BIGINT,
  error TEXT,
  result_json JSONB
);
CREATE INDEX IF NOT EXISTS idx_voiceover_pick ON voiceover_jobs(status, available_at, priority DESC, created_at);
