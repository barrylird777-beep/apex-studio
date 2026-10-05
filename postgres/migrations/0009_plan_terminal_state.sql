CREATE OR REPLACE FUNCTION apex_sync_execution_plan_terminal_state()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='failed' THEN
    UPDATE apex_execution_plans SET status='failed',last_error=COALESCE(NEW.last_error,'Execution node failed'),
      version=version+1,updated_at=NOW()
    WHERE id=NEW.plan_id AND status NOT IN ('completed','failed','cancelled');
  ELSIF NEW.status='completed' THEN
    PERFORM 1 FROM apex_execution_nodes
    WHERE plan_id=NEW.plan_id AND status <> 'completed';
    IF NOT FOUND THEN
      UPDATE apex_execution_plans SET status='completed',version=version+1,updated_at=NOW()
      WHERE id=NEW.plan_id AND status NOT IN ('completed','failed','cancelled');
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS apex_execution_node_terminal_plan_gate ON apex_execution_nodes;
CREATE TRIGGER apex_execution_node_terminal_plan_gate
AFTER UPDATE OF status,verification ON apex_execution_nodes
FOR EACH ROW EXECUTE FUNCTION apex_sync_execution_plan_terminal_state();
