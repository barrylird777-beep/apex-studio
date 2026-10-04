CREATE TABLE IF NOT EXISTS "apex_worker_tasks" (
  "id" uuid PRIMARY KEY NOT NULL,
  "worker_id" text NOT NULL,
  "role" text NOT NULL,
  "task" text NOT NULL,
  "status" text NOT NULL DEFAULT 'queued',
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 5,
  "lease_owner" text,
  "lease_token" text,
  "lease_expires_at" timestamptz,
  "next_run_at" timestamptz,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "result" jsonb,
  "last_error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "apex_worker_tasks"
  ADD COLUMN IF NOT EXISTS "lease_token" text,
  ADD COLUMN IF NOT EXISTS "next_run_at" timestamptz;

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.apex_worker_tasks'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) NOT ILIKE '%claimed%'
  LOOP
    EXECUTE format('ALTER TABLE public.apex_worker_tasks DROP CONSTRAINT %I', constraint_name);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.apex_worker_tasks'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%claimed%'
  ) THEN
    ALTER TABLE public.apex_worker_tasks
      ADD CONSTRAINT apex_worker_tasks_status_check
      CHECK (status IN ('queued','claimed','running','completed','failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "apex_worker_tasks_queue_idx"
  ON "apex_worker_tasks" ("status", "next_run_at", "created_at");

CREATE INDEX IF NOT EXISTS "apex_worker_tasks_lease_idx"
  ON "apex_worker_tasks" ("status", "lease_expires_at");

CREATE INDEX IF NOT EXISTS "apex_worker_tasks_claimed_running_idx"
  ON "apex_worker_tasks" ("lease_expires_at")
  WHERE "status" IN ('claimed','running');
