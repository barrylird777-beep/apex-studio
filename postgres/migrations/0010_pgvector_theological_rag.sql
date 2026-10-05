-- pgvector-backed theological retrieval.
-- Embedding dimension is configurable by deployment; 1536 is the canonical default
-- for Apex's initial embedding pipeline.
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE apex_theological_source_chunks
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

CREATE INDEX IF NOT EXISTS apex_theological_chunks_embedding_hnsw_idx
  ON apex_theological_source_chunks
  USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;
