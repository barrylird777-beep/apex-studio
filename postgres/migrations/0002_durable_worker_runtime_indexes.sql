CREATE INDEX IF NOT EXISTS apex_worker_tasks_recovery_idx
  ON apex_worker_tasks(status, lease_expires_at)
  WHERE status = 'running' AND lease_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS apex_external_effects_status_idx
  ON apex_external_effects(status, updated_at);
