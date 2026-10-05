-- Durable webhook delivery observability and retry state.
ALTER TABLE apex_worker_tasks
  ADD COLUMN IF NOT EXISTS webhook_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS webhook_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS webhook_last_error TEXT,
  ADD COLUMN IF NOT EXISTS webhook_next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS apex_worker_tasks_webhook_due_idx
  ON apex_worker_tasks(webhook_next_attempt_at, updated_at)
  WHERE status = 'completed'
    AND webhook_dispatched_at IS NULL
    AND webhook_status IN ('pending', 'failed');

UPDATE apex_worker_tasks
   SET webhook_status = CASE
     WHEN webhook_dispatched_at IS NOT NULL THEN 'sent'
     ELSE 'pending'
   END
 WHERE webhook_status IS NULL
    OR (webhook_dispatched_at IS NOT NULL AND webhook_status <> 'sent');
