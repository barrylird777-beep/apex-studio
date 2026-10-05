import { pool as defaultPool } from "../index.ts";

function safeLimit(value, fallback = 50) {
  return Math.max(1, Math.min(500, Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback));
}

function cleanQuery(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

export class BibleSearch {
  constructor(pool = defaultPool) {
    this.pool = pool;
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
