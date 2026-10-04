CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  tokens DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS apex_external_effects (
  idempotency_key TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'started',
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS apex_external_effects_status_idx
  ON apex_external_effects(status);

CREATE INDEX IF NOT EXISTS rate_limits_updated_at_idx
  ON rate_limits(updated_at);
