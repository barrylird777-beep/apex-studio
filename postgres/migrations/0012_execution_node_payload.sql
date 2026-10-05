ALTER TABLE apex_execution_nodes
  ADD COLUMN IF NOT EXISTS input JSONB NOT NULL DEFAULT 'null'::jsonb,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS apex_execution_nodes_capability_idx
  ON apex_execution_nodes(capability,status,updated_at);
