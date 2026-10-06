-- Garden of Apex: independent Jesus Freak ecosystem.
-- Deliberately separate from Studio production entities.
CREATE TABLE IF NOT EXISTS "garden_places" (
  "id" bigserial PRIMARY KEY,
  "slug" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "kind" text NOT NULL DEFAULT 'garden',
  "description" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "garden_freaks" (
  "id" bigserial PRIMARY KEY,
  "slug" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "kind" text NOT NULL,
  "life_stage" text NOT NULL DEFAULT 'active',
  "specialties" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "description" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "place_id" bigint REFERENCES "garden_places"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "garden_freaks_kind_idx" ON "garden_freaks" ("kind");
CREATE INDEX IF NOT EXISTS "garden_freaks_place_idx" ON "garden_freaks" ("place_id");
CREATE TABLE IF NOT EXISTS "garden_discoveries" (
  "id" bigserial PRIMARY KEY,
  "slug" text NOT NULL UNIQUE,
  "title" text NOT NULL,
  "kind" text NOT NULL DEFAULT 'popcorn',
  "description" text NOT NULL,
  "source_ref" text,
  "provenance" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'discovered',
  "rating" integer,
  "created_by_freak_id" bigint REFERENCES "garden_freaks"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "garden_discoveries_rating_chk" CHECK ("rating" IS NULL OR ("rating" >= 0 AND "rating" <= 100))
);
CREATE INDEX IF NOT EXISTS "garden_discoveries_kind_status_idx" ON "garden_discoveries" ("kind", "status");
CREATE TABLE IF NOT EXISTS "garden_relationships" (
  "id" bigserial PRIMARY KEY,
  "from_freak_id" bigint NOT NULL REFERENCES "garden_freaks"("id") ON DELETE CASCADE,
  "to_freak_id" bigint NOT NULL REFERENCES "garden_freaks"("id") ON DELETE CASCADE,
  "relationship" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "garden_relationships_no_self_chk" CHECK ("from_freak_id" <> "to_freak_id"),
  CONSTRAINT "garden_relationships_unique" UNIQUE ("from_freak_id", "to_freak_id", "relationship")
);
CREATE INDEX IF NOT EXISTS "garden_relationships_to_idx" ON "garden_relationships" ("to_freak_id");
INSERT INTO "garden_places" ("slug", "name", "kind", "description")
VALUES ('the-garden-of-apex', 'THE Garden of Apex', 'garden', 'The living world and ecosystem of the Jesus Freaks.')
ON CONFLICT ("slug") DO NOTHING;
