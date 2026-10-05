CREATE INDEX IF NOT EXISTS apex_worker_tasks_worker_status_idx
  ON apex_worker_tasks(worker_id,status,next_run_at);

CREATE INDEX IF NOT EXISTS apex_execution_nodes_dependencies_idx
  ON apex_execution_nodes(plan_id,status);

ALTER TABLE apex_execution_nodes
  ADD CONSTRAINT apex_execution_nodes_no_self_dependency
  CHECK (NOT (id = ANY(depends_on)));

CREATE OR REPLACE FUNCTION apex_prevent_execution_node_completed_without_verification()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='completed' AND NEW.verification IS NULL THEN
    RAISE EXCEPTION 'Execution node % cannot complete without verification evidence', NEW.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS apex_execution_node_verification_gate ON apex_execution_nodes;
CREATE TRIGGER apex_execution_node_verification_gate
BEFORE INSERT OR UPDATE OF status,verification ON apex_execution_nodes
FOR EACH ROW EXECUTE FUNCTION apex_prevent_execution_node_completed_without_verification();
