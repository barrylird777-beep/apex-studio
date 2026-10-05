-- Apex search acceleration: database-native full-text indexes.
-- Keep source text authoritative; indexes are derived and rebuildable.
CREATE INDEX IF NOT EXISTS "bible_passages_search_gin_idx"
  ON "bible_passages"
  USING GIN (to_tsvector('simple',
    coalesce("reference",'') || ' ' ||
    coalesce("book",'') || ' ' ||
    coalesce("text",'')
  ));

CREATE INDEX IF NOT EXISTS "bible_research_search_gin_idx"
  ON "bible_research"
  USING GIN (to_tsvector('simple',
    coalesce("kind",'') || ' ' ||
    coalesce("title",'') || ' ' ||
    coalesce("content",'') || ' ' ||
    coalesce("source",'')
  ));

CREATE INDEX IF NOT EXISTS "bible_entities_search_gin_idx"
  ON "bible_entities"
  USING GIN (to_tsvector('simple',
    coalesce("kind",'') || ' ' ||
    coalesce("name",'') || ' ' ||
    coalesce("description",'')
  ));

CREATE INDEX IF NOT EXISTS "bible_popcorns_search_gin_idx"
  ON "bible_popcorns"
  USING GIN (to_tsvector('simple',
    coalesce("excerpt",'') || ' ' ||
    coalesce("reason",'') || ' ' ||
    coalesce("visual_potential",'') || ' ' ||
    coalesce("dialogue_potential",'') || ' ' ||
    coalesce("conflict_potential",'') || ' ' ||
    coalesce("emotional_potential",'') || ' ' ||
    coalesce("production_notes",'')
  ));

CREATE INDEX IF NOT EXISTS "bible_sources_search_gin_idx"
  ON "bible_sources"
  USING GIN (to_tsvector('simple',
    coalesce("source_type",'') || ' ' ||
    coalesce("name",'') || ' ' ||
    coalesce("version",'') || ' ' ||
    coalesce("language",'') || ' ' ||
    coalesce("license",'')
  ));

-- Trigram similarity catches misspellings and transliteration variants.
-- Extension creation is intentionally kept in the migration so fresh production databases
-- receive the capability before the dependent indexes are created.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "bible_sources_name_trgm_idx"
  ON "bible_sources" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "bible_entities_name_trgm_idx"
  ON "bible_entities" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "bible_passages_reference_trgm_idx"
  ON "bible_passages" USING GIN ("reference" gin_trgm_ops);

-- Compound trigram search surfaces for the highest-value Bible text fields.
CREATE INDEX IF NOT EXISTS "bible_passages_text_trgm_idx"
  ON "bible_passages" USING GIN ("text" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "bible_research_content_trgm_idx"
  ON "bible_research" USING GIN ("content" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "bible_popcorns_excerpt_trgm_idx"
  ON "bible_popcorns" USING GIN ("excerpt" gin_trgm_ops);
