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

-- Canonical initial Garden places. These are world locations, not Studio rooms.
INSERT INTO "garden_places" ("slug","name","kind","description") VALUES
('garden-heart','Garden Heart','realm','The central gathering place of THE Garden of Apex.'),
('garden-grove','Knowledge Grove','realm','A place where Kernels develop specialized disciplines.'),
('garden-meadow','Discovery Meadow','realm','A place where discoveries and Popcorns emerge.'),
('garden-workshop','Freak Workshop','realm','A place for Freaks to develop ideas before production.')
ON CONFLICT ("slug") DO NOTHING;

CREATE TABLE IF NOT EXISTS "garden_lineage" (
  "id" bigserial PRIMARY KEY,
  "discovery_id" bigint NOT NULL REFERENCES "garden_discoveries"("id") ON DELETE CASCADE,
  "freak_id" bigint REFERENCES "garden_freaks"("id") ON DELETE SET NULL,
  "stage" text NOT NULL,
  "sequence_no" integer NOT NULL,
  "source_ref" text,
  "evidence" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "garden_lineage_sequence_chk" CHECK ("sequence_no" >= 0),
  CONSTRAINT "garden_lineage_unique" UNIQUE ("discovery_id","sequence_no")
);
CREATE INDEX IF NOT EXISTS "garden_lineage_discovery_idx" ON "garden_lineage" ("discovery_id","sequence_no");
CREATE INDEX IF NOT EXISTS "garden_lineage_freak_idx" ON "garden_lineage" ("freak_id");

CREATE TABLE IF NOT EXISTS "garden_discovery_links" (
  "id" bigserial PRIMARY KEY,
  "discovery_id" bigint NOT NULL REFERENCES "garden_discoveries"("id") ON DELETE CASCADE,
  "freak_id" bigint REFERENCES "garden_freaks"("id") ON DELETE SET NULL,
  "relationship" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "garden_discovery_links_unique" UNIQUE ("discovery_id", "freak_id", "relationship")
);
CREATE INDEX IF NOT EXISTS "garden_discovery_links_discovery_idx" ON "garden_discovery_links" ("discovery_id");
CREATE INDEX IF NOT EXISTS "garden_discovery_links_freak_idx" ON "garden_discovery_links" ("freak_id");

CREATE TABLE IF NOT EXISTS "garden_activities" (
  "id" bigserial PRIMARY KEY,
  "place_id" bigint REFERENCES "garden_places"("id") ON DELETE SET NULL,
  "freak_id" bigint REFERENCES "garden_freaks"("id") ON DELETE SET NULL,
  "activity" text NOT NULL,
  "state" text NOT NULL DEFAULT 'active',
  "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "ended_at" timestamptz,
  CONSTRAINT "garden_activities_state_check" CHECK ("state" IN ('active','completed','paused','cancelled')),
  CONSTRAINT "garden_activities_time_check" CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at")
);
CREATE INDEX IF NOT EXISTS "garden_activities_place_idx" ON "garden_activities" ("place_id","state");
CREATE INDEX IF NOT EXISTS "garden_activities_freak_idx" ON "garden_activities" ("freak_id","state");

CREATE TABLE IF NOT EXISTS "garden_events" (
  "id" bigserial PRIMARY KEY,
  "event_type" text NOT NULL,
  "place_id" bigint REFERENCES "garden_places"("id") ON DELETE SET NULL,
  "freak_id" bigint REFERENCES "garden_freaks"("id") ON DELETE SET NULL,
  "discovery_id" bigint REFERENCES "garden_discoveries"("id") ON DELETE SET NULL,
  "activity_id" bigint REFERENCES "garden_activities"("id") ON DELETE SET NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "occurred_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "garden_events_time_idx" ON "garden_events" ("occurred_at" DESC);
CREATE INDEX IF NOT EXISTS "garden_events_place_idx" ON "garden_events" ("place_id","occurred_at" DESC);
CREATE INDEX IF NOT EXISTS "garden_events_freak_idx" ON "garden_events" ("freak_id","occurred_at" DESC);

INSERT INTO garden_places (parent_id,slug,name,kind,description,metadata)
SELECT NULL,'garden-heart','Garden Heart','sanctuary','The central gathering place of THE Garden of Apex.','{"canonical":true}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM garden_places WHERE slug='garden-heart');

INSERT INTO garden_places (parent_id,slug,name,kind,description,metadata)
SELECT (SELECT id FROM garden_places WHERE slug='garden-heart'),'freak-groves','Freak Groves','habitat','Spaces where Jesus Freaks grow, specialize, study, and develop.','{"canonical":true}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM garden_places WHERE slug='freak-groves');

INSERT INTO garden_places (parent_id,slug,name,kind,description,metadata)
SELECT (SELECT id FROM garden_places WHERE slug='garden-heart'),'discovery-fields','Discovery Fields','research','Open areas for Popcorn discoveries, investigation, and evidence gathering.','{"canonical":true}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM garden_places WHERE slug='discovery-fields');

INSERT INTO garden_places (parent_id,slug,name,kind,description,metadata)
SELECT (SELECT id FROM garden_places WHERE slug='garden-heart'),'kornworks','KornWorks','workshop','Creative transformation spaces where discoveries become new creative work.','{"canonical":true}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM garden_places WHERE slug='kornworks');

INSERT INTO garden_places (parent_id,slug,name,kind,description,metadata)
SELECT (SELECT id FROM garden_places WHERE slug='garden-heart'),'story-gardens','Story Gardens','story','Spaces for developing narrative ideas, Scripture connections, and story concepts.','{"canonical":true}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM garden_places WHERE slug='story-gardens');
