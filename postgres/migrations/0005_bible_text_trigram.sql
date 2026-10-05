-- Apex Bible search: trigram acceleration for passage text and reference lookup.
-- Separate migration so already-applied 0004 remains immutable.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "bible_passages_text_trgm_idx"
  ON "bible_passages" USING GIN ("text" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "bible_passages_book_trgm_idx"
  ON "bible_passages" USING GIN ("book" gin_trgm_ops);
