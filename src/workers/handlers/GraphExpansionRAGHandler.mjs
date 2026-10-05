import { log } from "../../core/resilience/load-shedder.mjs";
import { VectorRagEngine } from "../../ai/vector-rag-engine.mjs";

const EMBEDDING_DIMENSIONS = 1536;

function requireText(value, name, max = 10000) {
  const text = String(value ?? "").trim();
  if (!text || text.length > max) throw new Error(`Invalid ${name}`);
  return text;
}

function unwrapEmbedding(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.embedding)) return result.embedding;
  if (Array.isArray(result?.data?.[0]?.embedding)) return result.data[0].embedding;
  throw new TypeError("Unsupported embedding provider response");
}

function validateEpisodeId(value) {
  const id = String(value ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid episodeId");
  return id;
}

export class GraphExpansionRAGHandler {
  constructor(pool, embeddingProvider) {
    if (!pool) throw new TypeError("GraphExpansionRAGHandler requires PostgreSQL");
    if (!embeddingProvider || typeof embeddingProvider.createEmbedding !== "function") {
      throw new TypeError("GraphExpansionRAGHandler requires an embedding provider with createEmbedding(text)");
    }
    this.pool = pool;
    this.ragEngine = new VectorRagEngine(pool);
    this.embeddingProvider = embeddingProvider;
  }

  async process(payload = {}) {
    const episodeId = validateEpisodeId(payload.episodeId);
    const book = requireText(payload.book, "book", 200);
    const chapter = Number(payload.chapter);
    if (!Number.isInteger(chapter) || chapter < 1) throw new Error("Invalid chapter");
    const type = requireText(payload.type || "theological", "type", 100);
    const queryText = String(payload.queryText || `${book} chapter ${chapter} theological analysis, commentary, and historical context`).trim();

    log("info", "Executing RAG-powered graph expansion", {
      episode_id: episodeId,
      book,
      chapter,
      expansion_type: type
    });

    const providerResult = await this.embeddingProvider.createEmbedding(queryText, {
      episodeId,
      purpose: "graph-expansion",
      model: process.env.APEX_EMBEDDING_MODEL || null
    });
    const queryEmbedding = unwrapEmbedding(providerResult);

    if (queryEmbedding.length !== EMBEDDING_DIMENSIONS || !queryEmbedding.every(Number.isFinite)) {
      throw new Error(`Query embedding must contain exactly ${EMBEDDING_DIMENSIONS} finite numbers`);
    }

    const relevantChunks = await this.ragEngine.searchContext(queryEmbedding, 6);
    const corpus = relevantChunks.map((chunk) => ({
      sourceId: chunk.source_id,
      chunkId: chunk.chunk_id,
      chunkIndex: chunk.chunk_index,
      author: chunk.author,
      title: chunk.title,
      sourceType: chunk.source_type,
      language: chunk.language,
      license: chunk.license,
      sourceUri: chunk.source_uri,
      bookTarget: chunk.book_target,
      chapterTarget: chunk.chapter_target,
      verseTarget: chunk.verse_target,
      content: chunk.content,
      similarityScore: Number(chunk.similarity)
    }));

    await this.pool.query(
      `INSERT INTO apex_episode_context (episode_id, context_type, raw_data)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (episode_id, context_type)
       DO UPDATE SET raw_data=EXCLUDED.raw_data, updated_at=NOW()`,
      [
        episodeId,
        `rag-expansion-${type}`,
        JSON.stringify({
          book,
          chapter,
          queryText,
          retrievedChunksCount: corpus.length,
          corpus,
          generatedAt: new Date().toISOString()
        })
      ]
    );

    log("info", "RAG expansion context stored", {
      episode_id: episodeId,
      chunks_injected: corpus.length
    });

    return {
      episodeId,
      expansionType: type,
      retrievedChunksCount: corpus.length
    };
  }
}

export default GraphExpansionRAGHandler;
