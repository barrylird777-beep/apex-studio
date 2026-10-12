CREATE TABLE IF NOT EXISTS durable_jobs (
  id UUID PRIMARY KEY,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','dead')),
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  lease_owner TEXT,
  lease_token UUID,
  lease_fence BIGINT NOT NULL DEFAULT 0 CHECK (lease_fence >= 0),
  lease_expires_at TIMESTAMPTZ,
  result JSONB,
  last_error TEXT,
  dedupe_key TEXT,
  recovered_count INTEGER NOT NULL DEFAULT 0 CHECK (recovered_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE durable_jobs ADD COLUMN IF NOT EXISTS lease_owner TEXT;
ALTER TABLE durable_jobs ADD COLUMN IF NOT EXISTS lease_token UUID;
ALTER TABLE durable_jobs ADD COLUMN IF NOT EXISTS lease_fence BIGINT NOT NULL DEFAULT 0;
ALTER TABLE durable_jobs ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
ALTER TABLE durable_jobs ADD COLUMN IF NOT EXISTS result JSONB;
ALTER TABLE durable_jobs ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE durable_jobs ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
ALTER TABLE durable_jobs ADD COLUMN IF NOT EXISTS recovered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE durable_jobs ADD COLUMN IF NOT EXISTS run_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE durable_jobs ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE durable_jobs ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5;
ALTER TABLE durable_jobs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE durable_jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS durable_jobs_claim_idx ON durable_jobs(status, run_at, created_at);
CREATE INDEX IF NOT EXISTS durable_jobs_lease_idx ON durable_jobs(status, lease_expires_at) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS durable_jobs_recovery_idx ON durable_jobs(status, lease_expires_at, updated_at) WHERE status = 'running';
CREATE UNIQUE INDEX IF NOT EXISTS durable_jobs_dedupe_idx ON durable_jobs(dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued','running');
