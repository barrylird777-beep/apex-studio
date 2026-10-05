-- Massive-source ingestion foundation.
-- Keep source identity/provenance separate from verse/chapter targeting.
CREATE TABLE IF NOT EXISTS apex_theological_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author TEXT NOT NULL,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'theological',
  language TEXT,
  license TEXT,
  source_uri TEXT,
  content_sha256 TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (content_sha256)
);

CREATE INDEX IF NOT EXISTS apex_theological_sources_author_idx
  ON apex_theological_sources(author);

CREATE INDEX IF NOT EXISTS apex_theological_sources_type_idx
  ON apex_theological_sources(source_type);

CREATE TABLE IF NOT EXISTS apex_theological_source_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES apex_theological_sources(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  book_target TEXT,
  chapter_target INTEGER,
  verse_target TEXT,
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS apex_theological_source_chunks_target_idx
  ON apex_theological_source_chunks(book_target, chapter_target);

CREATE INDEX IF NOT EXISTS apex_theological_source_chunks_source_idx
  ON apex_theological_source_chunks(source_id, chunk_index);
