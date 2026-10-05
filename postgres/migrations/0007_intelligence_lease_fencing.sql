ALTER TABLE apex_execution_nodes
  ADD COLUMN IF NOT EXISTS worker_lease_token TEXT;

CREATE INDEX IF NOT EXISTS apex_execution_nodes_worker_lease_idx
  ON apex_execution_nodes(worker_task_id,worker_lease_token);

