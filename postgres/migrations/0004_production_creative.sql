CREATE TABLE IF NOT EXISTS "shots" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "scene_id" integer NOT NULL REFERENCES "scenes"("id") ON DELETE CASCADE,
  "shot_index" integer NOT NULL,
  "prompt" text NOT NULL,
  "duration_frames" integer NOT NULL DEFAULT 72,
  "status" text NOT NULL DEFAULT 'planned',
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "shots_scene_shot_unique" ON "shots" ("scene_id","shot_index");
CREATE INDEX IF NOT EXISTS "shots_project_scene_idx" ON "shots" ("project_id","scene_id");

CREATE TABLE IF NOT EXISTS "protocobs" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "scene_id" integer REFERENCES "scenes"("id") ON DELETE SET NULL,
  "title" text NOT NULL,
  "concept" text NOT NULL,
  "prompt" text,
  "visual_dna" jsonb DEFAULT '{}'::jsonb,
  "artifact_path" text,
  "status" text NOT NULL DEFAULT 'pending',
  "corn_nuts" integer,
  "created_by" text NOT NULL DEFAULT 'cob',
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "protocobs_project_status_idx" ON "protocobs" ("project_id","status");

CREATE TABLE IF NOT EXISTS "production_approvals" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "protocob_id" integer REFERENCES "protocobs"("id") ON DELETE CASCADE,
  "artifact_id" integer REFERENCES "scene_artifacts"("id") ON DELETE CASCADE,
  "action" text NOT NULL,
  "note" text,
  "created_at" timestamptz DEFAULT now()
);