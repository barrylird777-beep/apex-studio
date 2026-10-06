ALTER TABLE apex_external_effects
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS apex_external_effects_lease_idx
  ON apex_external_effects(status, lease_expires_at);

UPDATE apex_external_effects
   SET lease_expires_at = COALESCE(lease_expires_at, updated_at + INTERVAL '5 minutes')
 WHERE status = 'started' AND lease_expires_at IS NULL;
