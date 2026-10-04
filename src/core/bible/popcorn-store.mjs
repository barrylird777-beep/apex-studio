import pg from "pg";

const { Pool } = pg;
let pool;

function getPool() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (!pool) pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Math.max(5, Number(process.env.APEX_POPCORN_DB_POOL_MAX || 20))
  });
  return pool;
}

export async function ensurePopcornSchema() {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS bible_popcorns (
      id UUID PRIMARY KEY,
      collection_id TEXT NOT NULL DEFAULT 'default',
      book TEXT,
      chapter INTEGER,
      verse_start INTEGER,
      verse_end INTEGER,
      reference TEXT NOT NULL,
      excerpt TEXT NOT NULL,
      title TEXT,
      cinematic_reason TEXT NOT NULL,
      character_moment TEXT,
      visual_moment TEXT,
      dialogue_potential TEXT,
      conflict_tension TEXT,
      emotional_beat TEXT,
      production_potential TEXT,
      popcorn_rank INTEGER NOT NULL DEFAULT 0,
      confidence NUMERIC(5,4) NOT NULL DEFAULT 0,
      verification_status TEXT NOT NULL DEFAULT 'ai-review',
      canonical_source TEXT,
      source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      project_id INTEGER,
      scene_id INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(collection_id, reference)
    );
    CREATE INDEX IF NOT EXISTS bible_popcorns_reference_idx ON bible_popcorns(reference);
    CREATE INDEX IF NOT EXISTS bible_popcorns_rank_idx ON bible_popcorns(popcorn_rank DESC);
    CREATE INDEX IF NOT EXISTS bible_popcorns_collection_idx ON bible_popcorns(collection_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS bible_popcorns_project_scene_idx ON bible_popcorns(project_id, scene_id);
  `);
}

export async function upsertPopcorns(items = []) {
  if (!items.length) return [];
  const db = getPool();
  await ensurePopcornSchema();
  const client = await db.connect();
  const saved = [];
  try {
    await client.query("BEGIN");
    for (const item of items) {
      const id = item.id || crypto.randomUUID();
      const r = await client.query(
        `INSERT INTO bible_popcorns
        (id,collection_id,book,chapter,verse_start,verse_end,reference,excerpt,title,
         cinematic_reason,character_moment,visual_moment,dialogue_potential,conflict_tension,
         emotional_beat,production_potential,popcorn_rank,confidence,verification_status,
         canonical_source,source_metadata,provenance,tags,project_id,scene_id,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22::jsonb,$23::jsonb,$24,$25,NOW())
        ON CONFLICT (collection_id,reference) DO UPDATE SET
          excerpt=EXCLUDED.excerpt,title=EXCLUDED.title,cinematic_reason=EXCLUDED.cinematic_reason,
          character_moment=EXCLUDED.character_moment,visual_moment=EXCLUDED.visual_moment,
          dialogue_potential=EXCLUDED.dialogue_potential,conflict_tension=EXCLUDED.conflict_tension,
          emotional_beat=EXCLUDED.emotional_beat,production_potential=EXCLUDED.production_potential,
          popcorn_rank=EXCLUDED.popcorn_rank,confidence=EXCLUDED.confidence,
          verification_status=EXCLUDED.verification_status,canonical_source=EXCLUDED.canonical_source,
          source_metadata=EXCLUDED.source_metadata,provenance=EXCLUDED.provenance,tags=EXCLUDED.tags,
          project_id=EXCLUDED.project_id,scene_id=EXCLUDED.scene_id,updated_at=NOW()
        RETURNING *`,
        [
          id, String(item.collectionId || "default"), item.book || null,
          Number.isFinite(Number(item.chapter)) ? Number(item.chapter) : null,
          Number.isFinite(Number(item.verseStart)) ? Number(item.verseStart) : null,
          Number.isFinite(Number(item.verseEnd)) ? Number(item.verseEnd) : null,
          String(item.reference), String(item.excerpt), item.title || null,
          String(item.cinematicReason || ""), item.characterMoment || null, item.visualMoment || null,
          item.dialoguePotential || null, item.conflictTension || null, item.emotionalBeat || null,
          item.productionPotential || null, Math.max(0, Math.min(100, Number(item.popcornRank) || 0)),
          Math.max(0, Math.min(1, Number(item.confidence) || 0)), String(item.verificationStatus || "ai-review"),
          item.canonicalSource || null, JSON.stringify(item.sourceMetadata || {}),
          JSON.stringify(item.provenance || {}), JSON.stringify(Array.isArray(item.tags) ? item.tags : []),
          item.projectId ? Number(item.projectId) : null, item.sceneId ? Number(item.sceneId) : null
        ]
      );
      saved.push(r.rows[0]);
    }
    await client.query("COMMIT");
    return saved;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listPopcorns({ collectionId = "default", q = "", limit = 100, offset = 0 } = {}) {
  const db = getPool();
  await ensurePopcornSchema();
  const params = [String(collectionId), Math.max(1, Math.min(500, Number(limit) || 100)), Math.max(0, Number(offset) || 0)];
  const search = String(q || "").trim();
  let sql = "SELECT * FROM bible_popcorns WHERE collection_id=$1";
  if (search) {
    params.push("%" + search.replace(/[%_]/g, "\\$&") + "%");
    sql += " AND (reference ILIKE $4 ESCAPE '\\' OR excerpt ILIKE $4 ESCAPE '\\' OR title ILIKE $4 ESCAPE '\\' OR cinematic_reason ILIKE $4 ESCAPE '\\')";
  }
  sql += " ORDER BY popcorn_rank DESC, reference ASC LIMIT $2 OFFSET $3";
  const r = await db.query(sql, params);
  return r.rows;
}

export async function getPopcorn(id) {
  const db = getPool();
  await ensurePopcornSchema();
  const r = await db.query("SELECT * FROM bible_popcorns WHERE id=$1", [id]);
  return r.rows[0] || null;
}

export async function closePopcornStore() {
  if (pool) await pool.end();
  pool = null;
}
