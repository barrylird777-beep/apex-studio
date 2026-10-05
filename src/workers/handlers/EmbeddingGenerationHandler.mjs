import { log } from "../../core/resilience/load-shedder.mjs";

const EMBEDDING_DIMENSIONS = 1536;

function validateEmbedding(vector) {
  if (!Array.isArray(vector)) throw new TypeError("Embedding provider must return an array");
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Embedding dimension mismatch: expected ${EMBEDDING_DIMENSIONS}, received ${vector.length}`);
  }
  if (!vector.every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new Error("Embedding contains a non-finite or non-numeric value");
  }
  return vector;
}

function unwrapEmbedding(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.embedding)) return result.embedding;
  if (Array.isArray(result?.data?.[0]?.embedding)) return result.data[0].embedding;
  throw new TypeError("Unsupported embedding provider response");
}

export class EmbeddingGenerationHandler {
  constructor(pool, embeddingProvider, { rateLimit = null } = {}) {
    if (!pool) throw new TypeError("EmbeddingGenerationHandler requires PostgreSQL");
    if (!embeddingProvider || typeof embeddingProvider.createEmbedding !== "function") {
      throw new TypeError("EmbeddingGenerationHandler requires an embedding provider with createEmbedding(text)");
    }
    this.pool = pool;
    this.embeddingProvider = embeddingProvider;
    this.rateLimit = rateLimit;
  }

  async process(payload = {}) {
    const chunkId = String(payload.chunkId || "").trim();
    const sourceId = String(payload.sourceId || "").trim();
    if (!chunkId || !sourceId) throw new Error("Embedding task requires chunkId and sourceId");

    const chunkResult = await this.pool.query(
      `SELECT c.id AS chunk_id, c.source_id, c.content, c.chunk_index,
              c.book_target, c.chapter_target, c.verse_target,
              s.author, s.title, s.license, s.source_uri
         FROM apex_theological_source_chunks c
         JOIN apex_theological_sources s ON s.id = c.source_id
        WHERE c.id = $1 AND c.source_id = $2`,
      [chunkId, sourceId]
    );

    if (chunkResult.rowCount !== 1) {
      throw new Error(`Source chunk ${chunkId} for source ${sourceId} not found`);
    }

    const chunk = chunkResult.rows[0];
    if (!String(chunk.content || "").trim()) {
      throw new Error(`Source chunk ${chunkId} contains no embeddable content`);
    }

    if (this.rateLimit && !(await this.rateLimit())) {
      throw new Error("Embedding provider rate limit unavailable");
    }

    const providerResult = await this.embeddingProvider.createEmbedding(chunk.content, {
      sourceId,
      chunkId,
      model: process.env.APEX_EMBEDDING_MODEL || null
    });

    const embedding = validateEmbedding(unwrapEmbedding(providerResult));
    const vectorLiteral = `[${embedding.join(",")}]`;

    const stored = await this.pool.query(
      `UPDATE apex_theological_source_chunks
          SET embedding = $1::vector
        WHERE id = $2 AND source_id = $3
        RETURNING id`,
      [vectorLiteral, chunkId, sourceId]
    );

    if (stored.rowCount !== 1) {
      throw new Error(`Embedding target disappeared during generation: ${chunkId}`);
    }

    log("info", "Theological source chunk embedding stored", {
      chunk_id: chunkId,
      source_id: sourceId,
      chunk_index: chunk.chunk_index,
      embedding_dimensions: embedding.length
    });

    return { chunkId, sourceId, dimensions: embedding.length, embedded: true };
  }
}

export { EMBEDDING_DIMENSIONS, validateEmbedding };
