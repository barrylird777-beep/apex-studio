ALTER TABLE apex_execution_nodes
  ADD COLUMN IF NOT EXISTS worker_lease_token TEXT;

CREATE INDEX IF NOT EXISTS apex_execution_nodes_worker_lease_idx
  ON apex_execution_nodes(worker_task_id, worker_lease_token);

CREATE OR REPLACE FUNCTION apex_execution_plan_terminal_state()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  total_nodes INTEGER;
  completed_nodes INTEGER;
  failed_nodes INTEGER;
BEGIN
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE status='completed'),
         COUNT(*) FILTER (WHERE status='failed')
    INTO total_nodes,completed_nodes,failed_nodes
    FROM apex_execution_nodes WHERE plan_id=NEW.plan_id;

  IF total_nodes > 0 AND completed_nodes = total_nodes THEN
    UPDATE apex_execution_plans SET status='completed',version=version+1,updated_at=NOW()
      WHERE id=NEW.plan_id AND status NOT IN ('completed','cancelled');
  ELSIF failed_nodes > 0 THEN
    UPDATE apex_execution_plans SET status='failed',version=version+1,updated_at=NOW()
      WHERE id=NEW.plan_id AND status NOT IN ('failed','completed','cancelled');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS apex_execution_plan_terminal_state_trigger ON apex_execution_nodes;
CREATE TRIGGER apex_execution_plan_terminal_state_trigger
AFTER INSERT OR UPDATE OF status ON apex_execution_nodes
FOR EACH ROW EXECUTE FUNCTION apex_execution_plan_terminal_state();
