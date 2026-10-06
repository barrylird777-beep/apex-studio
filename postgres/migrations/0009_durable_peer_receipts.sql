CREATE TABLE IF NOT EXISTS durable_job_receipts (
  wave_id TEXT PRIMARY KEY,
  origin_job_id UUID NOT NULL,
  checksum TEXT NOT NULL,
  origin_fence BIGINT NOT NULL DEFAULT 0,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS durable_job_receipts_accepted_idx
  ON durable_job_receipts(accepted_at);
