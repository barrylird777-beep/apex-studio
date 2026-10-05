CREATE TABLE IF NOT EXISTS apex_worker_tasks (
  id UUID PRIMARY KEY,
  worker_id TEXT NOT NULL,
  role TEXT NOT NULL,
  task TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  lease_owner TEXT,
  lease_token TEXT,
  lease_expires_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dedupe_key TEXT,
  recovered_count INTEGER NOT NULL DEFAULT 0 CHECK (recovered_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS apex_worker_tasks_dedupe_idx
  ON apex_worker_tasks(dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status IN ('queued','running');

CREATE INDEX IF NOT EXISTS apex_worker_tasks_claim_idx
  ON apex_worker_tasks(status, next_run_at, created_at);

CREATE INDEX IF NOT EXISTS apex_worker_tasks_lease_idx
  ON apex_worker_tasks(status, lease_expires_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  tokens DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS apex_external_effects (
  idempotency_key TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started','completed')),
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
