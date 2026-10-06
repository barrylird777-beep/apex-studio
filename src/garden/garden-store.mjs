import { pool as dbPool } from '../db/index.ts';

export async function listGardenPlaces() {
  const result = await dbPool.query(
    'SELECT id,parent_id,slug,name,kind,description,metadata,created_at FROM garden_places ORDER BY id'
  );
  return result.rows;
}

export async function createGardenPlace(input = {}) {
  const name = String(input.name || '').trim();
  const slug = String(input.slug || name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const kind = String(input.kind || 'place').trim();
  if (!name || name.length > 200 || !slug || slug.length > 200 || !kind || kind.length > 80) throw new TypeError('Invalid Garden place');
  const parentId = input.parentId == null ? null : Number(input.parentId);
  if (parentId !== null && !Number.isInteger(parentId)) throw new TypeError('Invalid Garden parent');
  const result = await dbPool.query(
    'INSERT INTO garden_places (parent_id,slug,name,kind,description,metadata) VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING *',
    [parentId,slug,name,kind,String(input.description || '').trim(),JSON.stringify(input.metadata && typeof input.metadata === 'object' ? input.metadata : {})]
  );
  return result.rows[0];
}

export async function recordGardenEvent(input = {}) {
  const eventType = String(input.eventType || '').trim();
  if (!eventType || eventType.length > 120) throw new TypeError('Invalid Garden event type');
  const ids = ['placeId','freakId','discoveryId','activityId'].map(k => input[k] == null ? null : Number(input[k]));
  if (ids.some(v => v !== null && !Number.isInteger(v))) throw new TypeError('Invalid Garden event reference');
  const result = await dbPool.query(
    'INSERT INTO garden_events (event_type,place_id,freak_id,discovery_id,activity_id,payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING *',
    [eventType,...ids,JSON.stringify(input.payload && typeof input.payload === 'object' ? input.payload : {})]
  );
  return result.rows[0];
}

export async function listGardenEvents(limit = 100) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const result = await dbPool.query(
    'SELECT e.*,p.name AS place_name,f.name AS freak_name,d.title AS discovery_title FROM garden_events e LEFT JOIN garden_places p ON p.id=e.place_id LEFT JOIN garden_freaks f ON f.id=e.freak_id LEFT JOIN garden_discoveries d ON d.id=e.discovery_id ORDER BY e.occurred_at DESC LIMIT $1',
    [safeLimit]
  );
  return result.rows;
}

export async function listGardenActivities(state = null) {
  const result = await dbPool.query(
    'SELECT a.id,a.place_id,a.freak_id,a.activity,a.state,a.details,a.started_at,a.ended_at,p.name AS place_name,f.name AS freak_name FROM garden_activities a LEFT JOIN garden_places p ON p.id=a.place_id LEFT JOIN garden_freaks f ON f.id=a.freak_id WHERE ($1::text IS NULL OR a.state=$1) ORDER BY a.id DESC',
    [state ? String(state) : null]
  );
  return result.rows;
}

export async function createGardenActivity(input = {}) {
  const activity = String(input.activity || '').trim();
  const state = String(input.state || 'active').trim();
  if (!activity || activity.length > 200 || !['active','completed','paused','cancelled'].includes(state)) throw new TypeError('Invalid Garden activity');
  const placeId = input.placeId == null ? null : Number(input.placeId);
  const freakId = input.freakId == null ? null : Number(input.freakId);
  if ((placeId !== null && !Number.isInteger(placeId)) || (freakId !== null && !Number.isInteger(freakId))) throw new TypeError('Invalid Garden activity reference');
  const result = await dbPool.query(
    'INSERT INTO garden_activities (place_id,freak_id,activity,state,details) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING *',
    [placeId,freakId,activity,state,JSON.stringify(input.details && typeof input.details === 'object' ? input.details : {})]
  );
  return result.rows[0];
}

export async function getGardenWorld() {
  const [garden, places, freaks, specialties, states, discoveries, relationships, discoveryLinks, activities, events] = await Promise.all([
    dbPool.query('SELECT * FROM garden_places WHERE slug=$1', ['the-garden-of-apex']),
    dbPool.query('SELECT * FROM garden_places ORDER BY id'),
    dbPool.query('SELECT * FROM garden_freaks ORDER BY id'),
    dbPool.query('SELECT * FROM garden_freak_specialties ORDER BY freak_id,specialty'),
    dbPool.query('SELECT * FROM garden_freak_state ORDER BY freak_id'),
    dbPool.query('SELECT * FROM garden_discoveries ORDER BY created_at DESC'),
    dbPool.query('SELECT * FROM garden_relationships ORDER BY id'),
    dbPool.query('SELECT * FROM garden_discovery_links ORDER BY id'),
    dbPool.query('SELECT * FROM garden_activities ORDER BY id DESC LIMIT 500'),
    dbPool.query('SELECT * FROM garden_events ORDER BY occurred_at DESC LIMIT 500')
  ]);
  return {
    garden: garden.rows[0] ?? null,
    places: places.rows,
    freaks: freaks.rows,
    specialties: specialties.rows,
    states: states.rows,
    discoveries: discoveries.rows,
    relationships: relationships.rows,
    discoveryLinks: discoveryLinks.rows,
    activities: activities.rows,
    events: events.rows
  };
}

export async function getGarden() {
  const [place, freaks, discoveries] = await Promise.all([
    dbPool.query('SELECT id, slug, name, kind, description, metadata, created_at, updated_at FROM garden_places WHERE slug=$1', ['the-garden-of-apex']),
    dbPool.query('SELECT id, slug, name, kind, life_stage, specialties, description, metadata, place_id, created_at, updated_at FROM garden_freaks ORDER BY id'),
    dbPool.query('SELECT id, slug, title, kind, description, source_ref, provenance, status, rating, created_by_freak_id, created_at, updated_at FROM garden_discoveries ORDER BY created_at DESC')
  ]);
  return { garden: place.rows[0] ?? null, freaks: freaks.rows, discoveries: discoveries.rows };
}

export async function listGardenFreakState(freakId = null) {
  const id = freakId == null ? null : Number(freakId);
  if (id !== null && !Number.isInteger(id)) throw new TypeError('Invalid Garden Freak id');
  const result = await dbPool.query(
    'SELECT s.*,f.name,f.kind,f.life_stage FROM garden_freak_state s JOIN garden_freaks f ON f.id=s.freak_id WHERE ($1::bigint IS NULL OR s.freak_id=$1) ORDER BY s.freak_id',
    [id]
  );
  return result.rows;
}

export async function setGardenFreakState(freakId, input = {}) {
  const id = Number(freakId);
  if (!Number.isInteger(id)) throw new TypeError('Invalid Garden Freak id');
  const status = String(input.status || 'active').trim();
  if (!['active','resting','learning','creating','exploring','inactive'].includes(status)) throw new TypeError('Invalid Garden Freak status');
  const energy = input.energy == null ? 100 : Number(input.energy);
  const focus = input.focus == null ? 100 : Number(input.focus);
  const experience = input.experience == null ? 0 : Number(input.experience);
  if (![energy,focus].every(Number.isInteger) || energy < 0 || energy > 100 || focus < 0 || focus > 100 || !Number.isInteger(experience) || experience < 0) throw new TypeError('Invalid Garden Freak state');
  const result = await dbPool.query(
    'INSERT INTO garden_freak_state (freak_id,status,energy,focus,experience,state) VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT (freak_id) DO UPDATE SET status=EXCLUDED.status,energy=EXCLUDED.energy,focus=EXCLUDED.focus,experience=EXCLUDED.experience,state=EXCLUDED.state,updated_at=now() RETURNING *',
    [id,status,energy,focus,experience,JSON.stringify(input.state && typeof input.state === 'object' ? input.state : {})]
  );
  return result.rows[0];
}

export async function listGardenFreakSpecialties(freakId = null) {
  const id = freakId == null ? null : Number(freakId);
  if (id !== null && !Number.isInteger(id)) throw new TypeError('Invalid Garden Freak id');
  const result = await dbPool.query(
    'SELECT s.*,f.name FROM garden_freak_specialties s JOIN garden_freaks f ON f.id=s.freak_id WHERE ($1::bigint IS NULL OR s.freak_id=$1) ORDER BY s.freak_id,s.specialty',
    [id]
  );
  return result.rows;
}

export async function setGardenFreakSpecialty(freakId, input = {}) {
  const id = Number(freakId);
  const specialty = String(input.specialty || '').trim();
  const level = input.level == null ? 1 : Number(input.level);
  if (!Number.isInteger(id) || !specialty || specialty.length > 120 || !Number.isInteger(level) || level < 1 || level > 100) throw new TypeError('Invalid Garden Freak specialty');
  const result = await dbPool.query(
    'INSERT INTO garden_freak_specialties (freak_id,specialty,level,metadata) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (freak_id,specialty) DO UPDATE SET level=EXCLUDED.level,metadata=EXCLUDED.metadata,updated_at=now() RETURNING *',
    [id,specialty,level,JSON.stringify(input.metadata && typeof input.metadata === 'object' ? input.metadata : {})]
  );
  return result.rows[0];
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

export async function linkGardenDiscovery(discoveryId, freakId, relationship, metadata = {}) {
  const discovery = Number(discoveryId);
  const freak = freakId == null ? null : Number(freakId);
  const rel = String(relationship || '').trim();
  if (!Number.isInteger(discovery) || (freak !== null && !Number.isInteger(freak)) || !rel || rel.length > 100) throw new TypeError('Invalid Garden discovery link');
  const result = await dbPool.query(
    'INSERT INTO garden_discovery_links (discovery_id,freak_id,relationship,metadata) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (discovery_id,freak_id,relationship) DO UPDATE SET metadata=EXCLUDED.metadata RETURNING *',
    [discovery,freak,rel,JSON.stringify(metadata && typeof metadata === 'object' ? metadata : {})]
  );
  return result.rows[0];
}

export async function listGardenDiscoveryLinks(discoveryId) {
  const result = await dbPool.query(
    'SELECT l.id,l.discovery_id,l.freak_id,l.relationship,l.metadata,l.created_at,f.name AS freak_name FROM garden_discovery_links l LEFT JOIN garden_freaks f ON f.id=l.freak_id WHERE l.discovery_id=$1 ORDER BY l.id',
    [Number(discoveryId)]
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
