ALTER TABLE apex_worker_tasks
  ADD COLUMN IF NOT EXISTS trace_id TEXT,
  ADD COLUMN IF NOT EXISTS last_worker_pid INTEGER,
  ADD COLUMN IF NOT EXISTS quarantine_reason TEXT;

CREATE INDEX IF NOT EXISTS apex_worker_tasks_trace_id_idx
  ON apex_worker_tasks(trace_id)
  WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS apex_worker_tasks_quarantine_idx
  ON apex_worker_tasks(status, updated_at)
  WHERE quarantine_reason IS NOT NULL;
