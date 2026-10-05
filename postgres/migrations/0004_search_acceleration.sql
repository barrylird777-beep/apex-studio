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
