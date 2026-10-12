CREATE TABLE IF NOT EXISTS "asset_provenance" (
  "id" bigserial PRIMARY KEY,
  "run_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "status" text NOT NULL,
  "artifact_id" text,
  "shot" text,
  "path" text,
  "sha256" text,
  "model" text,
  "voice" text,
  "labels" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "sources" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "spec" jsonb,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "asset_provenance_run_idx"
  ON "asset_provenance" ("run_id", "created_at");

CREATE INDEX IF NOT EXISTS "asset_provenance_artifact_idx"
  ON "asset_provenance" ("artifact_id")
  WHERE "artifact_id" IS NOT NULL;
