ALTER TABLE apex_external_effects
  ADD COLUMN IF NOT EXISTS lease_owner TEXT,
  ADD COLUMN IF NOT EXISTS lease_token TEXT,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS apex_external_effects_recovery_idx
  ON apex_external_effects(status,lease_expires_at);

ALTER TABLE apex_external_effects
  DROP CONSTRAINT IF EXISTS apex_external_effects_status_check;

ALTER TABLE apex_external_effects
  ADD CONSTRAINT apex_external_effects_status_check
  CHECK (status IN ('started','completed'));

