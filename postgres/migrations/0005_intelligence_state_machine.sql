CREATE OR REPLACE FUNCTION apex_validate_execution_node_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='completed' AND NEW.verification IS NULL THEN
    RAISE EXCEPTION 'Execution node % cannot complete without verification evidence', NEW.id;
  END IF;
  IF OLD.status='completed' AND NEW.status <> 'completed' THEN
    RAISE EXCEPTION 'Completed execution node % cannot be reopened', NEW.id;
  END IF;
  IF NEW.status='running' AND NEW.worker_task_id IS NULL THEN
    RAISE EXCEPTION 'Running execution node % requires a worker task', NEW.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS apex_execution_node_verification_gate ON apex_execution_nodes;
CREATE TRIGGER apex_execution_node_verification_gate
BEFORE INSERT OR UPDATE ON apex_execution_nodes
FOR EACH ROW EXECUTE FUNCTION apex_validate_execution_node_transition();

CREATE OR REPLACE FUNCTION apex_mark_plan_completed_if_terminal()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='completed' THEN
    PERFORM 1 FROM apex_execution_nodes
    WHERE plan_id=NEW.plan_id AND status <> 'completed';
    IF NOT FOUND THEN
      UPDATE apex_execution_plans SET status='completed',version=version+1,updated_at=NOW()
      WHERE id=NEW.plan_id AND status <> 'completed';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS apex_execution_node_terminal_plan_gate ON apex_execution_nodes;
CREATE TRIGGER apex_execution_node_terminal_plan_gate
AFTER UPDATE OF status,verification ON apex_execution_nodes
FOR EACH ROW EXECUTE FUNCTION apex_mark_plan_completed_if_terminal();
