-- Repair drift in apex_worker_tasks for databases created by older migration revisions.
-- All changes are additive and idempotent.

ALTER TABLE apex_worker_tasks
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT,
  ADD COLUMN IF NOT EXISTS trace_id TEXT,
  ADD COLUMN IF NOT EXISTS last_worker_pid INTEGER,
  ADD COLUMN IF NOT EXISTS quarantine_reason TEXT,
  ADD COLUMN IF NOT EXISTS recovered_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE apex_worker_tasks
  DROP CONSTRAINT IF EXISTS apex_worker_tasks_recovered_count_check;

ALTER TABLE apex_worker_tasks
  ADD CONSTRAINT apex_worker_tasks_recovered_count_check
  CHECK (recovered_count >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS apex_worker_tasks_dedupe_idx
  ON apex_worker_tasks(dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status IN ('queued','running');

CREATE INDEX IF NOT EXISTS apex_worker_tasks_trace_idx
  ON apex_worker_tasks(trace_id)
  WHERE trace_id IS NOT NULL;
