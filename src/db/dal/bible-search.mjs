import pg from "pg";

const { Pool } = pg;

function createDefaultPool() {
  const connectionString = String(process.env.DATABASE_URL || "").trim();
  if (!connectionString) throw new Error("DATABASE_URL is required for PostgreSQL Bible search.");
  return new Pool({
    connectionString,
    max: Math.max(2, Math.min(20, Number(process.env.APEX_DB_POOL_MAX || 20))),
    idleTimeoutMillis: Number(process.env.APEX_DB_IDLE_TIMEOUT_MS || 30000),
    connectionTimeoutMillis: Number(process.env.APEX_DB_CONNECTION_TIMEOUT_MS || 10000)
  });
}

function safeLimit(value, fallback = 50) {
  return Math.max(1, Math.min(500, Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback));
}

function cleanQuery(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

export class BibleSearch {
  constructor(pool = null) {
    this.pool = pool ?? createDefaultPool();
  }

  async search(queryText, { limit = 50, collectionId = null, similarityThreshold = 0.3 } = {}) {
    const query = cleanQuery(queryText);
    if (!query) return [];
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL pg_trgm.similarity_threshold = $1", [Number(similarityThreshold)]);
      const params = [query, safeLimit(limit)];
      const scope = collectionId == null ? "" : " AND p.collection_id = $3";
      if (collectionId != null) params.push(Number(collectionId));
      const { rows } = await client.query(
        `SELECT p.id, p.collection_id, p.source_id, p.reference, p.book, p.chapter,
                p.verse_start, p.verse_end, p.text,
                similarity(p.text, $1) AS similarity
           FROM bible_passages p
          WHERE p.text % $1${scope}
          ORDER BY similarity DESC, p.id ASC
          LIMIT $2`,
        params
      );
      await client.query("COMMIT");
      return rows;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async fuzzySearch(queryText, { limit = 50, collectionId = null } = {}) {
    const query = cleanQuery(queryText);
    if (!query) return [];
    const params = [query, safeLimit(limit)];
    const scope = collectionId == null ? "" : " AND p.collection_id = $3";
    if (collectionId != null) params.push(Number(collectionId));
    const { rows } = await this.pool.query(
      `SELECT p.id, p.collection_id, p.source_id, p.reference, p.book, p.chapter,
              p.verse_start, p.verse_end, p.text,
              similarity(p.text, $1) AS similarity
         FROM bible_passages p
        WHERE p.text % $1${scope}
        ORDER BY similarity DESC, p.id ASC
        LIMIT $2`,
      params
    );
    return rows;
  }

  async partialSearch(queryText, { limit = 50, collectionId = null } = {}) {
    const query = cleanQuery(queryText);
    if (query.length < 3) return [];
    const params = [`%${query.replace(/[%_\\]/g, "\\$&")}%`, safeLimit(limit)];
    const scope = collectionId == null ? "" : " AND p.collection_id = $3";
    if (collectionId != null) params.push(Number(collectionId));
    const { rows } = await this.pool.query(
      `SELECT p.id, p.collection_id, p.source_id, p.reference, p.book, p.chapter,
              p.verse_start, p.verse_end, p.text
         FROM bible_passages p
        WHERE p.text ILIKE $1 ESCAPE '\\\\'${scope}
        ORDER BY p.id ASC
        LIMIT $2`,
      params
    );
    return rows;
  }

  async referenceSearch(queryText, { limit = 50, collectionId = null } = {}) {
    const query = cleanQuery(queryText);
    if (query.length < 3) return [];
    const params = [query, safeLimit(limit)];
    const scope = collectionId == null ? "" : " AND p.collection_id = $3";
    if (collectionId != null) params.push(Number(collectionId));
    const { rows } = await this.pool.query(
      `SELECT p.id, p.collection_id, p.source_id, p.reference, p.book, p.chapter,
              p.verse_start, p.verse_end, p.text,
              similarity(p.reference, $1) AS similarity
         FROM bible_passages p
        WHERE p.reference % $1${scope}
        ORDER BY similarity DESC, p.id ASC
        LIMIT $2`,
      params
    );
    return rows;
  }
}
