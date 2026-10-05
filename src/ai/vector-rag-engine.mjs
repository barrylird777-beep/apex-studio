import { logger } from "../core/resilience/load-shedder.mjs";

function validateEmbedding(value) {
  if (!Array.isArray(value) || value.length !== 1536) {
    throw new TypeError("queryEmbedding must contain exactly 1536 finite numbers");
  }
  if (!value.every(number => Number.isFinite(number))) {
    throw new TypeError("queryEmbedding contains a non-finite value");
  }
  return `[${value.join(",")}]`;
}

export class VectorRagEngine {
  constructor(pool) {
    if (!pool) throw new TypeError("VectorRagEngine requires PostgreSQL");
    this.pool = pool;
  }

  async searchContext(queryEmbedding, limit = 5) {
    const vectorLiteral = validateEmbedding(queryEmbedding);
    const safeLimit = Math.max(1, Math.min(50, Number(limit) || 5));
    const client = await this.pool.connect();

    try {
      const result = await client.query(
        `SELECT
           c.id AS chunk_id,
           c.source_id,
           c.chunk_index,
           c.content,
           c.book_target,
           c.chapter_target,
           c.verse_target,
           1 - (c.embedding <=> $1::vector) AS similarity,
           s.author,
           s.title,
           s.source_type,
           s.language,
           s.license,
           s.source_uri,
           s.metadata AS source_metadata
         FROM apex_theological_source_chunks c
         JOIN apex_theological_sources s ON s.id = c.source_id
        WHERE c.embedding IS NOT NULL
        ORDER BY c.embedding <=> $1::vector
        LIMIT $2`,
        [vectorLiteral, safeLimit]
      );

      return result.rows;
    } catch (error) {
      logger.error("Vector similarity search failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      client.release();
    }
  }
}
