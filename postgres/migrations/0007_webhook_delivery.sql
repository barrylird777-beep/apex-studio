-- Webhook delivery state for completed durable worker events.
ALTER TABLE apex_worker_tasks
  ADD COLUMN IF NOT EXISTS webhook_dispatched_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS apex_worker_tasks_webhook_pending_idx
  ON apex_worker_tasks(status, updated_at)
  WHERE status = 'completed' AND webhook_dispatched_at IS NULL;
