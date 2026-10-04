CREATE TABLE IF NOT EXISTS "projects" (
  "id" serial PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "primary_scripture" text,
  "status" text DEFAULT 'development',
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "characters" (
  "id" serial PRIMARY KEY NOT NULL,
  "canonical_name" text NOT NULL,
  "aliases" jsonb DEFAULT '[]'::jsonb,
  "primary_stories" jsonb DEFAULT '[]'::jsonb,
  "relationships" jsonb DEFAULT '[]'::jsonb,
  "key_traits" jsonb DEFAULT '[]'::jsonb,
  "notes" text,
  "scripture_references" jsonb DEFAULT '[]'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS "characters_canonical_name_unique" ON "characters" ("canonical_name");
CREATE TABLE IF NOT EXISTS "scenes" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "scene_number" integer,
  "title" text,
  "scripture_ref" text NOT NULL,
  "location" text,
  "characters_present" jsonb DEFAULT '[]'::jsonb,
  "action_summary" text,
  "emotional_beat" text,
  "production_notes" text,
  "estimated_pages" real,
  "day_or_night" text
);
CREATE UNIQUE INDEX IF NOT EXISTS "scenes_project_scene_number_unique" ON "scenes" ("project_id","scene_number");
CREATE TABLE IF NOT EXISTS "shoot_days" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "date" text NOT NULL,
  "call_time" text,
  "unit" text DEFAULT '1st Unit',
  "notes" text
);
CREATE UNIQUE INDEX IF NOT EXISTS "shoot_days_project_date_unique" ON "shoot_days" ("project_id","date");
CREATE INDEX IF NOT EXISTS "shoot_days_project_date_idx" ON "shoot_days" ("project_id","date");
CREATE TABLE IF NOT EXISTS "shoot_day_scenes" (
  "scene_id" integer PRIMARY KEY NOT NULL REFERENCES "scenes"("id") ON DELETE CASCADE,
  "shoot_day_id" integer REFERENCES "shoot_days"("id") ON DELETE CASCADE,
  "project_id" integer REFERENCES "projects"("id") ON DELETE CASCADE,
  "shoot_date" text,
  "position" integer NOT NULL
);
CREATE INDEX IF NOT EXISTS "shoot_day_scenes_day_position_idx" ON "shoot_day_scenes" ("shoot_day_id","position");
CREATE TABLE IF NOT EXISTS "call_sheets" (
  "id" serial PRIMARY KEY NOT NULL,
  "shoot_day_id" integer NOT NULL REFERENCES "shoot_days"("id") ON DELETE CASCADE,
  "general_call_time" text,
  "weather_notes" text,
  "special_requirements" text,
  "pdf_path" text,
  "crew" jsonb DEFAULT '[]'::jsonb,
  "cast" jsonb DEFAULT '[]'::jsonb,
  "locations" jsonb DEFAULT '[]'::jsonb,
  "characters" jsonb DEFAULT '[]'::jsonb,
  "call_times" jsonb DEFAULT '{}'::jsonb,
  "scene_ids" jsonb DEFAULT '[]'::jsonb,
  "updated_at" timestamptz DEFAULT now(),
  "created_at" timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "budget_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "category" text NOT NULL,
  "description" text NOT NULL,
  "estimated" real DEFAULT 0,
  "actual" real DEFAULT 0,
  "notes" text
);
CREATE TABLE IF NOT EXISTS "script_notes" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "scene_id" integer REFERENCES "scenes"("id") ON DELETE SET NULL,
  "scripture_ref" text NOT NULL,
  "dialogue" text,
  "version_notes" text
);
CREATE TABLE IF NOT EXISTS "scene_artifacts" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "scene_id" integer NOT NULL REFERENCES "scenes"("id") ON DELETE CASCADE,
  "artifact_type" text NOT NULL,
  "storage_path" text NOT NULL,
  "content_hash" text NOT NULL,
  "lineage" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "scene_artifacts_content_hash_unique" ON "scene_artifacts" ("content_hash");
CREATE INDEX IF NOT EXISTS "scene_artifacts_project_scene_type_idx" ON "scene_artifacts" ("project_id","scene_id","artifact_type");
CREATE TABLE IF NOT EXISTS "bible_collections" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "owner_key" text DEFAULT 'owner',
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "bible_collections_owner_name_unique" ON "bible_collections" ("owner_key","name");
CREATE TABLE IF NOT EXISTS "bible_sources" (
  "id" serial PRIMARY KEY NOT NULL,
  "collection_id" integer NOT NULL REFERENCES "bible_collections"("id") ON DELETE CASCADE,
  "source_type" text NOT NULL,
  "name" text NOT NULL,
  "version" text,
  "language" text,
  "license" text,
  "uri" text,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "bible_sources_collection_name_unique" ON "bible_sources" ("collection_id","name");
CREATE TABLE IF NOT EXISTS "bible_passages" (
  "id" serial PRIMARY KEY NOT NULL,
  "collection_id" integer NOT NULL REFERENCES "bible_collections"("id") ON DELETE CASCADE,
  "source_id" integer REFERENCES "bible_sources"("id") ON DELETE SET NULL,
  "reference" text NOT NULL,
  "book" text,
  "chapter" integer,
  "verse_start" integer,
  "verse_end" integer,
  "text" text NOT NULL,
  "canonical" integer DEFAULT 1 NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "bible_passages_collection_reference_unique" ON "bible_passages" ("collection_id","reference");
CREATE INDEX IF NOT EXISTS "bible_passages_collection_book_chapter_idx" ON "bible_passages" ("collection_id","book","chapter");
CREATE TABLE IF NOT EXISTS "bible_research" (
  "id" serial PRIMARY KEY NOT NULL,
  "collection_id" integer NOT NULL REFERENCES "bible_collections"("id") ON DELETE CASCADE,
  "passage_id" integer NOT NULL REFERENCES "bible_passages"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "title" text,
  "content" text NOT NULL,
  "source" text,
  "source_uri" text,
  "verification" text DEFAULT 'unverified' NOT NULL,
  "confidence" real DEFAULT 0,
  "ai_generated" integer DEFAULT 0 NOT NULL,
  "provenance" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "bible_research_passage_kind_idx" ON "bible_research" ("passage_id","kind");
CREATE INDEX IF NOT EXISTS "bible_research_verification_idx" ON "bible_research" ("verification");
CREATE TABLE IF NOT EXISTS "bible_popcorns" (
  "id" serial PRIMARY KEY NOT NULL,
  "collection_id" integer NOT NULL REFERENCES "bible_collections"("id") ON DELETE CASCADE,
  "passage_id" integer NOT NULL REFERENCES "bible_passages"("id") ON DELETE CASCADE,
  "excerpt" text NOT NULL,
  "reason" text NOT NULL,
  "character_potential" text,
  "visual_potential" text,
  "dialogue_potential" text,
  "conflict_potential" text,
  "emotional_potential" text,
  "production_notes" text,
  "priority" integer DEFAULT 50 NOT NULL,
  "confidence" real DEFAULT 0,
  "verification" text DEFAULT 'pending' NOT NULL,
  "provenance" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "bible_popcorns_passage_excerpt_unique" ON "bible_popcorns" ("passage_id","excerpt");
CREATE INDEX IF NOT EXISTS "bible_popcorns_collection_priority_idx" ON "bible_popcorns" ("collection_id","priority");
CREATE TABLE IF NOT EXISTS "bible_links" (
  "id" serial PRIMARY KEY NOT NULL,
  "collection_id" integer NOT NULL REFERENCES "bible_collections"("id") ON DELETE CASCADE,
  "from_passage_id" integer REFERENCES "bible_passages"("id") ON DELETE CASCADE,
  "to_passage_id" integer REFERENCES "bible_passages"("id") ON DELETE CASCADE,
  "link_type" text NOT NULL,
  "label" text,
  "provenance" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "bible_links_collection_type_idx" ON "bible_links" ("collection_id","link_type");
CREATE TABLE IF NOT EXISTS "bible_notes" (
  "id" serial PRIMARY KEY NOT NULL,
  "collection_id" integer NOT NULL REFERENCES "bible_collections"("id") ON DELETE CASCADE,
  "passage_id" integer REFERENCES "bible_passages"("id") ON DELETE CASCADE,
  "popcorn_id" integer REFERENCES "bible_popcorns"("id") ON DELETE CASCADE,
  "note" text NOT NULL,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "bible_notes_passage_idx" ON "bible_notes" ("passage_id");
CREATE INDEX IF NOT EXISTS "bible_notes_popcorn_idx" ON "bible_notes" ("popcorn_id");
CREATE TABLE IF NOT EXISTS "scripture_evidence" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "collection_id" integer NOT NULL REFERENCES "bible_collections"("id") ON DELETE CASCADE,
  "premise" text NOT NULL,
  "selected_references" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "confidence" real DEFAULT 0 NOT NULL,
  "verification" text DEFAULT 'unverified' NOT NULL,
  "provenance" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "scripture_evidence_project_idx" ON "scripture_evidence" ("project_id");
CREATE INDEX IF NOT EXISTS "scripture_evidence_collection_idx" ON "scripture_evidence" ("collection_id");
CREATE TABLE IF NOT EXISTS "bible_entities" (
  "id" serial PRIMARY KEY NOT NULL,
  "collection_id" integer NOT NULL REFERENCES "bible_collections"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "name" text NOT NULL,
  "aliases" jsonb DEFAULT '[]'::jsonb,
  "description" text,
  "provenance" jsonb DEFAULT '{}'::jsonb,
  "verification" text DEFAULT 'unverified' NOT NULL,
  "confidence" real DEFAULT 0,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "bible_entities_collection_kind_name_unique" ON "bible_entities" ("collection_id","kind","name");
CREATE TABLE IF NOT EXISTS "bible_entity_links" (
  "id" serial PRIMARY KEY NOT NULL,
  "collection_id" integer NOT NULL REFERENCES "bible_collections"("id") ON DELETE CASCADE,
  "entity_id" integer NOT NULL REFERENCES "bible_entities"("id") ON DELETE CASCADE,
  "passage_id" integer NOT NULL REFERENCES "bible_passages"("id") ON DELETE CASCADE,
  "relationship" text DEFAULT 'mentioned' NOT NULL,
  "provenance" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "bible_entity_passage_relationship_unique" ON "bible_entity_links" ("entity_id","passage_id","relationship");
CREATE TABLE IF NOT EXISTS "bible_study_links" (
  "id" serial PRIMARY KEY NOT NULL,
  "collection_id" integer NOT NULL REFERENCES "bible_collections"("id") ON DELETE CASCADE,
  "passage_id" integer NOT NULL REFERENCES "bible_passages"("id") ON DELETE CASCADE,
  "project_id" integer REFERENCES "projects"("id") ON DELETE CASCADE,
  "scene_id" integer REFERENCES "scenes"("id") ON DELETE CASCADE,
  "popcorn_id" integer REFERENCES "bible_popcorns"("id") ON DELETE CASCADE,
  "link_type" text NOT NULL,
  "note" text,
  "provenance" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "bible_study_links_passage_project_scene_idx" ON "bible_study_links" ("passage_id","project_id","scene_id");