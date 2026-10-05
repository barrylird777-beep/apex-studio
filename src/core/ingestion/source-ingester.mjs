import crypto from "node:crypto";

function required(value, name, max = 1000) {
  const text = String(value ?? "").trim();
  if (!text || text.length > max) throw new Error(`Invalid ${name}`);
  return text;
}

function chunkText(text, size = 12000) {
  const source = required(text, "content", 20_000_000);
  const safeSize = Math.max(1000, Math.min(50000, Number(size) || 12000));
  const chunks = [];
  for (let offset = 0, index = 0; offset < source.length; offset += safeSize, index++) {
    chunks.push({ index, content: source.slice(offset, offset + safeSize) });
  }
  return chunks;
}

export class SourceIngester {
  constructor(pool) {
    if (!pool) throw new TypeError("SourceIngester requires PostgreSQL");
    this.pool = pool;
  }

  async ingestSource(metadata, { chunkSize = 12000 } = {}) {
    const author = required(metadata?.author, "author", 500);
    const title = required(metadata?.title, "title", 1000);
    const content = required(metadata?.content, "content", 20_000_000);
    const digest = crypto.createHash("sha256").update(content).digest("hex");
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      const source = await client.query(
        `INSERT INTO apex_theological_sources
           (author,title,source_type,language,license,source_uri,content_sha256,metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
         ON CONFLICT (content_sha256) DO UPDATE
           SET metadata = apex_theological_sources.metadata || EXCLUDED.metadata
         RETURNING id`,
        [
          author,
          title,
          String(metadata.sourceType || "theological"),
          metadata.language ? String(metadata.language) : null,
          metadata.license ? String(metadata.license) : null,
          metadata.sourceUri ? String(metadata.sourceUri) : null,
          digest,
          JSON.stringify(metadata.metadata || {})
        ]
      );

      const sourceId = source.rows[0].id;
      const chunks = chunkText(content, chunkSize);

      await client.query(
        "DELETE FROM apex_theological_source_chunks WHERE source_id=$1",
        [sourceId]
      );

      for (const chunk of chunks) {
        await client.query(
          `INSERT INTO apex_theological_source_chunks
             (source_id,chunk_index,book_target,chapter_target,verse_target,content,metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
          [
            sourceId,
            chunk.index,
            metadata.book || null,
            metadata.chapter == null ? null : Number(metadata.chapter),
            metadata.verses || null,
            chunk.content,
            JSON.stringify({ sha256: crypto.createHash("sha256").update(chunk.content).digest("hex") })
          ]
        );
      }

      await client.query("COMMIT");
      return { sourceId, contentSha256: digest, chunks: chunks.length };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
