ALTER TABLE apex_worker_tasks
  ADD COLUMN IF NOT EXISTS recovered_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE apex_worker_tasks
  DROP CONSTRAINT IF EXISTS apex_worker_tasks_recovered_count_check;

ALTER TABLE apex_worker_tasks
  ADD CONSTRAINT apex_worker_tasks_recovered_count_check CHECK (recovered_count >= 0);
