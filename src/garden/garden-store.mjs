import { pool as dbPool } from '../db/index.ts';

export async function getGarden() {
  const [place, freaks, discoveries] = await Promise.all([
    dbPool.query('SELECT id, slug, name, kind, description, metadata, created_at, updated_at FROM garden_places WHERE slug=$1', ['the-garden-of-apex']),
    dbPool.query('SELECT id, slug, name, kind, life_stage, specialties, description, metadata, place_id, created_at, updated_at FROM garden_freaks ORDER BY id'),
    dbPool.query('SELECT id, slug, title, kind, description, source_ref, provenance, status, rating, created_by_freak_id, created_at, updated_at FROM garden_discoveries ORDER BY created_at DESC')
  ]);
  return { garden: place.rows[0] ?? null, freaks: freaks.rows, discoveries: discoveries.rows };
}

export async function createGardenFreak(input = {}) {
  const kind = String(input.kind || '').toLowerCase();
  if (!['kernel','popcorn','cornnut','cob','protocob'].includes(kind)) throw new TypeError('Invalid Garden Freak kind');
  const lifeStage = String(input.lifeStage || 'active').toLowerCase();
  if (!['kernet','active'].includes(lifeStage)) throw new TypeError('Invalid Garden Freak life stage');
  const name = String(input.name || '').trim();
  if (!name || name.length > 200) throw new TypeError('name is required and must be <= 200 characters');
  const slug = String(input.slug || name).trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,120);
  if (!slug) throw new TypeError('slug is required');
  const specialties = Array.isArray(input.specialties) ? input.specialties.map(String).slice(0,50) : [];
  const result = await dbPool.query(
    'INSERT INTO garden_freaks (slug,name,kind,life_stage,specialties,description,metadata,place_id) SELECT $1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,id FROM garden_places WHERE slug=$8 RETURNING *',
    [slug,name,kind,lifeStage,JSON.stringify(specialties),input.description ? String(input.description) : null,JSON.stringify(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}),'the-garden-of-apex']
  );
  return result.rows[0] ?? null;
}

export async function relateGardenFreaks(fromFreakId, toFreakId, relationship, metadata = {}) {
  const from = Number(fromFreakId), to = Number(toFreakId);
  const rel = String(relationship || '').trim();
  if (!Number.isInteger(from) || !Number.isInteger(to) || from === to || !rel || rel.length > 100) throw new TypeError('Invalid Garden relationship');
  const result = await dbPool.query(
    'INSERT INTO garden_relationships (from_freak_id,to_freak_id,relationship,metadata) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (from_freak_id,to_freak_id,relationship) DO UPDATE SET metadata=EXCLUDED.metadata RETURNING *',
    [from,to,rel,JSON.stringify(metadata && typeof metadata === 'object' ? metadata : {})]
  );
  return result.rows[0];
}

export async function listGardenRelationships() {
  const result = await dbPool.query(
    'SELECT r.id,r.from_freak_id,r.to_freak_id,r.relationship,r.metadata,r.created_at,ff.name AS from_name,tf.name AS to_name FROM garden_relationships r JOIN garden_freaks ff ON ff.id=r.from_freak_id JOIN garden_freaks tf ON tf.id=r.to_freak_id ORDER BY r.id'
  );
  return result.rows;
}

export async function createGardenDiscovery(input = {}) {
  const title = String(input.title || '').trim();
  const description = String(input.description || '').trim();
  if (!title || !description) throw new TypeError('title and description are required');
  const kind = String(input.kind || 'popcorn').toLowerCase();
  const slug = String(input.slug || title).trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,120);
  if (!slug) throw new TypeError('slug is required');
  const rating = input.rating == null ? null : Number(input.rating);
  if (rating !== null && (!Number.isInteger(rating) || rating < 0 || rating > 100)) throw new TypeError('rating must be an integer from 0 to 100');
  const result = await dbPool.query('INSERT INTO garden_discoveries (slug,title,kind,description,source_ref,provenance,status,rating,created_by_freak_id) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9) RETURNING *', [slug,title,kind,description,input.sourceRef ? String(input.sourceRef) : null,JSON.stringify(input.provenance && typeof input.provenance === 'object' ? input.provenance : {}),String(input.status || 'discovered'),rating,input.createdByFreakId == null ? null : Number(input.createdByFreakId)]);
  return result.rows[0];
}
