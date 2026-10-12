import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { access } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BIBLE_CHARACTER_SEEDS } from '../data/bible-characters.mjs';
import { sovereignAppFabric } from '../core/sovereign-app-fabric.mjs';

const router = express.Router();
const dir = path.dirname(fileURLToPath(import.meta.url));
const dbDir = process.env.APEX_BIBLE_DB_DIR || path.resolve(dir, '../../data');
const legacyDbFile = path.resolve(process.env.APEX_BIBLE_DB || path.join(dbDir, 'apex-bible.sqlite'));
const APP = 'kernel-vision';
const MIGRATION_KEY = 'migration-bible-production-sqlite-v1';
const PREFIX = Object.freeze({
  project: 'bible-project-',
  character: 'bible-character-',
  scene: 'bible-scene-',
  shootDay: 'bible-shoot-day-',
  sceneShootDay: 'bible-scene-shoot-day-',
  callSheet: 'bible-call-sheet-',
  budgetItem: 'bible-budget-item-',
  scriptNote: 'bible-script-note-'
});
const now = () => new Date().toISOString();
const arr = value => Array.isArray(value) ? value : [];
const dec = value => {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
};
const decObject = value => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value || '{}'); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
};
const clean = (value, max = 4000) => String(value ?? '').trim().slice(0, max);
const validRef = value => /^[1-3]?\s?[A-Za-z]+(?:\s+[A-Za-z]+)*\s+\d+:\d+(?:-\d+)?$/.test(clean(value, 120));
const safeId = value => {
  const id = clean(value, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id) || id.includes('..')) throw Object.assign(new Error('Invalid record id'), { status: 400 });
  return id;
};
const slug = value => clean(value, 200).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || crypto.randomUUID();

function normalizeEntity(type, record) {
  if (!record) return record;
  const prefix = PREFIX[type];
  const id = record.entityId ?? (String(record.id || "").startsWith(prefix) ? String(record.id).slice(prefix.length) : record.id);
  return { ...record, id: String(id ?? "") };
}
async function listType(type) {
  const rows = await sovereignAppFabric.list(APP);
  return rows.filter(item => item.record?.recordType === type && item.record.deleted !== true).map(item => normalizeEntity(type, item.record));
}
async function getType(type, id) {
  const row = await sovereignAppFabric.get(APP, PREFIX[type] + safeId(id));
  return row && row.record?.deleted !== true && row.record?.recordType === type ? normalizeEntity(type, row.record) : null;
}
async function saveType(type, id, value) {
  const key = PREFIX[type] + safeId(id);
  const previous = await sovereignAppFabric.get(APP, key);
  const timestamp = now();
  const record = {
    ...(previous?.record || {}),
    ...value,
    id: safeId(id),
    entityId: safeId(id),
    recordType: type,
    createdAt: previous?.record?.createdAt || value.createdAt || timestamp,
    updatedAt: timestamp,
    deleted: false
  };
  await sovereignAppFabric.put(APP, key, record);
  return record;
}
async function softDelete(type, id) {
  const record = await getType(type, id);
  if (!record) return false;
  await sovereignAppFabric.put(APP, PREFIX[type] + safeId(id), { ...record, deleted: true, deletedAt: now(), updatedAt: now() });
  return true;
}
function projectOut(row, sceneCount = 0, shootDayCount = 0) {
  return {
    ...row, id: String(row.id),
    primaryScripture: row.primaryScripture || row.primary_scripture || '',
    primary_scripture: row.primaryScripture || row.primary_scripture || '',
    created_at: row.created_at || row.createdAt || null,
    updated_at: row.updated_at || row.updatedAt || null,
    scene_count: sceneCount, shoot_day_count: shootDayCount
  };
}
function characterOut(row) {
  const aliases = arr(row.aliases), primaryStories = arr(row.primaryStories || row.primary_stories);
  const relationships = arr(row.relationships), keyTraits = arr(row.keyTraits || row.key_traits);
  const scriptureReferences = arr(row.scriptureReferences || row.scripture_references);
  return {
    ...row, id: String(row.id), canonicalName: row.canonicalName || row.canonical_name || '',
    canonical_name: row.canonicalName || row.canonical_name || '',
    aliases, primaryStories, primary_stories: primaryStories, relationships,
    keyTraits, key_traits: keyTraits, notes: row.notes || '',
    scriptureReferences, scripture_references: scriptureReferences
  };
}
function sceneOut(row) {
  const characters = arr(row.characters || row.charactersPresent || row.characters_present);
  const charactersPresent = arr(row.charactersPresent || row.characters_present || row.characters);
  const scriptureReference = row.scriptureReference || row.scripture_ref || '';
  const projectId = String(row.projectId || row.project_id || '');
  const sceneNumber = Number(row.sceneNumber ?? row.scene_number) || 1;
  return {
    ...row, id: String(row.id), projectId, project_id: projectId,
    sceneNumber, scene_number: sceneNumber,
    scriptureReference, scripture_ref: scriptureReference,
    characters, charactersPresent, characters_present: charactersPresent,
    location: row.location || '', actionSummary: row.actionSummary || row.action_summary || '',
    action_summary: row.actionSummary || row.action_summary || '',
    emotionalBeat: row.emotionalBeat || row.emotional_beat || '',
    emotional_beat: row.emotionalBeat || row.emotional_beat || '',
    productionNotes: row.productionNotes || row.production_notes || '',
    production_notes: row.productionNotes || row.production_notes || '',
    estimatedPages: row.estimatedPages ?? row.estimated_pages ?? null,
    estimated_pages: row.estimatedPages ?? row.estimated_pages ?? null,
    dayOrNight: row.dayOrNight || row.day_or_night || '',
    day_or_night: row.dayOrNight || row.day_or_night || ''
  };
}
function shootDayOut(row) {
  const projectId = String(row.projectId || row.project_id || '');
  return { ...row, id: String(row.id), projectId, project_id: projectId, date: row.date || '', unit: row.unit || '1st Unit', notes: row.notes || '' };
}
function callSheetOut(row) {
  const projectId = String(row.projectId || row.project_id || '');
  const shootDate = row.shootDate || row.shoot_date || '';
  const generalCallTime = row.generalCallTime || row.general_call_time || '05:00';
  const weatherNotes = row.weatherNotes || row.weather_notes || '';
  const specialRequirements = row.specialRequirements || row.special_requirements || '';
  const crew = arr(row.crew), cast = arr(row.cast), locations = arr(row.locations), characters = arr(row.characters);
  const callTimes = decObject(row.callTimes || row.call_times);
  const sceneIds = arr(row.sceneIds || row.scene_ids).map(String);
  return {
    ...row, id: String(row.id), projectId, project_id: projectId,
    shootDate, shoot_date: shootDate, generalCallTime, general_call_time: generalCallTime,
    weatherNotes, weather_notes: weatherNotes, specialRequirements, special_requirements: specialRequirements,
    crew, cast, locations, characters, callTimes, call_times: callTimes, sceneIds, scene_ids: sceneIds
  };
}
function budgetOut(row) {
  const projectId = String(row.projectId || row.project_id || '');
  return { ...row, id: String(row.id), projectId, project_id: projectId, estimated: Number(row.estimated) || 0, actual: Number(row.actual) || 0 };
}
function noteOut(row) {
  const projectId = String(row.projectId || row.project_id || '');
  const sceneId = row.sceneId || row.scene_id || null;
  const scriptureReference = row.scriptureReference || row.scripture_ref || '';
  return { ...row, id: String(row.id), projectId, project_id: projectId, sceneId: sceneId == null ? null : String(sceneId), scene_id: sceneId == null ? null : String(sceneId), scriptureReference, scripture_ref: scriptureReference, dialogue: row.dialogue || '', versionNotes: row.versionNotes || row.version_notes || '', version_notes: row.versionNotes || row.version_notes || '' };
}
function idOf(type) { return type + '-' + crypto.randomUUID(); }
async function defaultProject() {
  const projects = await listType('project');
  if (projects.length) return projects[0];
  return saveType('project', 'default-project', {
    title: 'New KernelVision Production', description: '',
    primaryScripture: '', status: 'development', source: 'default-workspace'
  });
}
async function resolveProjectId(value) {
  if (value) {
    const id = safeId(value);
    if (!(await getType('project', id))) throw Object.assign(new Error('Project not found'), { status: 404 });
    return id;
  }
  return String((await defaultProject()).id);
}
async function seedCharacters() {
  const existing = (await sovereignAppFabric.list(APP)).filter(item => item.record?.recordType === 'character').map(item => item.record);
  const names = new Set(existing.map(row => String(row.canonicalName || '').toLowerCase()));
  for (const seed of BIBLE_CHARACTER_SEEDS) {
    const canonicalName = clean(seed.canonicalName, 180);
    if (!canonicalName || names.has(canonicalName.toLowerCase())) continue;
    const id = 'seed-' + slug(canonicalName);
    await saveType('character', id, {
      canonicalName, aliases: arr(seed.aliases), primaryStories: arr(seed.primaryStories),
      relationships: arr(seed.relationships), keyTraits: arr(seed.keyTraits),
      notes: clean(seed.notes, 3000), scriptureReferences: arr(seed.scriptureReferences),
      source: 'bible-character-seed'
    });
    names.add(canonicalName.toLowerCase());
  }
}
function openLegacySqlite(DatabaseSync, filename) {
  const database = new DatabaseSync(filename, { readOnly: true });
  return {
    all(sql, callback) {
      try { callback(null, database.prepare(sql).all()); }
      catch (error) { callback(error); }
    },
    close(callback) {
      try { database.close(); callback?.(); }
      catch (error) { callback?.(error); }
    }
  };
}
function readLegacyTable(db, table) {
  return new Promise((resolve, reject) => db.all('SELECT * FROM ' + table, (error, rows) => error ? reject(error) : resolve(rows || [])));
}
function readLegacyTableNames(db) {
  return new Promise((resolve, reject) => db.all("SELECT name FROM sqlite_master WHERE type='table'", (error, rows) => error ? reject(error) : resolve(new Set((rows || []).map(row => String(row.name))))));
}
function closeLegacySqlite(db) {
  return new Promise(resolve => db.close(() => resolve()));
}
async function hashFile(filename) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filename);
    stream.on('data', chunk => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return hash.digest('hex');
}
async function migrateLegacySqliteIfPresent() {
  const marker = await sovereignAppFabric.get(APP, MIGRATION_KEY);
  if (marker?.record?.status === 'completed') return marker.record;
  try { await access(legacyDbFile); } catch { return { status: 'not-present', imported: {} }; }

  let db;
  try {
    const sourceHashBefore = await hashFile(legacyDbFile);
    const { DatabaseSync } = await import('node:sqlite');
    db = openLegacySqlite(DatabaseSync, legacyDbFile);
    const tables = {};
    const availableTables = await readLegacyTableNames(db);
    for (const name of ['projects','characters','scenes','shoot_days','scene_shoot_days','call_sheets','budget_items','script_notes']) {
      tables[name] = availableTables.has(name) ? await readLegacyTable(db, name) : [];
    }
    await closeLegacySqlite(db); db = null;
    const characterNames = new Map(tables.characters.map(row => [String(row.id), String(row.canonical_name || '')]));
    const imported = {};
    const putIfMissing = async (type, id, record) => {
      const key = PREFIX[type] + safeId(id);
      const existing = await sovereignAppFabric.get(APP, key);
      if (!existing) { await sovereignAppFabric.put(APP, key, { ...record, id: String(id), entityId: String(id), recordType: type, source: 'legacy-sqlite-import', importedAt: now(), createdAt: record.createdAt || record.created_at || now(), updatedAt: record.updatedAt || record.updated_at || now(), deleted: false }); imported[type] = (imported[type] || 0) + 1; }
    };
    for (const row of tables.projects) await putIfMissing('project', row.id, { title: row.title || '', description: row.description || '', primaryScripture: row.primary_scripture || '', status: row.status || 'development', created_at: row.created_at || null, updated_at: row.updated_at || null });
    for (const row of tables.characters) await putIfMissing('character', row.id, {
      canonicalName: row.canonical_name || '', aliases: dec(row.aliases), primaryStories: dec(row.primary_stories),
      relationships: dec(row.relationships), keyTraits: dec(row.key_traits), notes: row.notes || '',
      scriptureReferences: dec(row.scripture_references), createdAt: row.created_at || null
    });
    for (const row of tables.scenes) {
      const rawCharacters = dec(row.characters_present);
      const characters = rawCharacters.map(value => characterNames.get(String(value)) || String(value));
      await putIfMissing('scene', row.id, {
        projectId: String(row.project_id), sceneNumber: row.scene_number, title: row.title || '',
        scriptureReference: row.scripture_ref || '', location: row.location || '',
        characters, charactersPresent: rawCharacters.map(String), actionSummary: row.action_summary || '',
        emotionalBeat: row.emotional_beat || '', productionNotes: row.production_notes || '',
        estimatedPages: row.estimated_pages ?? null, dayOrNight: row.day_or_night || '',
        created_at: row.created_at || null
      });
    }
    for (const row of tables.shoot_days) await putIfMissing('shootDay', row.id, { projectId: String(row.project_id), date: row.date || '', unit: row.unit || '1st Unit', notes: row.notes || '', created_at: row.created_at || null });
    for (const row of tables.scene_shoot_days) {
      const relationId = String(row.shoot_day_id) + '-' + String(row.scene_id);
      await putIfMissing('sceneShootDay', relationId, { shootDayId: String(row.shoot_day_id), sceneId: String(row.scene_id) });
    }
    for (const row of tables.call_sheets) await putIfMissing('callSheet', row.id, {
      projectId: row.project_id == null ? '' : String(row.project_id), shootDayId: row.shoot_day_id == null ? null : String(row.shoot_day_id),
      shootDate: row.shoot_date || '', generalCallTime: row.general_call_time || '05:00',
      weatherNotes: row.weather_notes || '', specialRequirements: row.special_requirements || '',
      crew: dec(row.crew), cast: dec(row.cast), locations: dec(row.locations), characters: dec(row.characters),
      callTimes: decObject(row.call_times), sceneIds: dec(row.scene_ids).map(String),
      createdAt: row.created_at || null, updatedAt: row.updated_at || null
    });
    for (const row of tables.budget_items) await putIfMissing('budgetItem', row.id, { projectId: String(row.project_id), category: row.category || '', description: row.description || '', estimated: Number(row.estimated) || 0, actual: Number(row.actual) || 0, notes: row.notes || '' });
    for (const row of tables.script_notes) await putIfMissing('scriptNote', row.id, { projectId: String(row.project_id), sceneId: row.scene_id == null ? null : String(row.scene_id), scriptureReference: row.scripture_ref || '', dialogue: row.dialogue || '', versionNotes: row.version_notes || '' });
    const sourceHash = await hashFile(legacyDbFile);
    if (sourceHash !== sourceHashBefore) throw new Error('Legacy SQLite file changed during the read-only import; retry migration');
    const result = { status: 'completed', sourceHash, imported, source: 'legacy-sqlite-read-only', completedAt: now() };
    await sovereignAppFabric.put(APP, MIGRATION_KEY, { recordType: 'migration-marker', ...result });
    return result;
  } catch (error) {
    if (db) await closeLegacySqlite(db);
    const result = { status: 'failed', source: 'legacy-sqlite-read-only', error: clean(error?.message || error, 1000), attemptedAt: now() };
    await sovereignAppFabric.put(APP, MIGRATION_KEY, { recordType: 'migration-marker', ...result }).catch(() => {});
    console.warn('[bible-production] legacy SQLite import deferred:', result.error);
    return result;
  }
}

const ready = (async () => {
  await sovereignAppFabric.init();
  await migrateLegacySqliteIfPresent();
  await seedCharacters();
  await defaultProject();
  return true;
})();
router.use((req, res, next) => ready.then(() => next()).catch(error => { console.error('[bible-production] storage initialization failed:', clean(error?.message || error, 500)); return res.status(503).json({ error: 'KernelVision production storage is unavailable' }); }));

router.get('/status', async (req, res) => {
  try {
    const marker = await sovereignAppFabric.get(APP, MIGRATION_KEY);
    const [projects, characters, scenes, shootDays, callSheets, budgetItems, scriptNotes] = await Promise.all([
      listType('project'), listType('character'), listType('scene'), listType('shootDay'),
      listType('callSheet'), listType('budgetItem'), listType('scriptNote')
    ]);
    res.json({ ok: true, storage: 'local-pure-wal', databaseDependency: false, migration: marker?.record || { status: 'not-present' }, counts: { projects: projects.length, characters: characters.length, scenes: scenes.length, shootDays: shootDays.length, callSheets: callSheets.length, budgetItems: budgetItems.length, scriptNotes: scriptNotes.length } });
  } catch (error) { res.status(503).json({ error: 'Production status unavailable' }); }
});

router.get('/projects', async (req, res) => {
  try {
    const [projects, scenes, shootDays] = await Promise.all([listType('project'), listType('scene'), listType('shootDay')]);
    res.json(projects.map(project => projectOut(project, scenes.filter(scene => String(scene.projectId) === String(project.id)).length, shootDays.filter(day => String(day.projectId) === String(project.id)).length)).sort((a,b) => String(b.updatedAt||'').localeCompare(String(a.updatedAt||''))));
  } catch (error) { res.status(500).json({ error: 'Projects unavailable' }); }
});
router.post('/projects', async (req, res) => {
  try {
    const title = clean(req.body?.title, 240);
    if (!title) return res.status(400).json({ error: 'title is required' });
    const record = await saveType('project', req.body?.id || idOf('project'), { title, description: clean(req.body?.description, 4000), primaryScripture: clean(req.body?.primaryScripture || req.body?.primary_scripture, 120), status: clean(req.body?.status || 'development', 60) });
    res.status(201).json(projectOut(record));
  } catch (error) { res.status(Number(error.status)||400).json({ error: clean(error.message, 500) }); }
});
router.put('/projects/:id', async (req, res) => {
  try {
    const current = await getType('project', req.params.id);
    if (!current) return res.status(404).json({ error: 'Project not found' });
    const title = clean(req.body?.title ?? current.title, 240);
    if (!title) return res.status(400).json({ error: 'title is required' });
    const record = await saveType('project', current.id, { ...current, title, description: clean(req.body?.description ?? current.description, 4000), primaryScripture: clean(req.body?.primaryScripture ?? req.body?.primary_scripture ?? current.primaryScripture, 120), status: clean(req.body?.status ?? current.status ?? 'development', 60) });
    res.json(projectOut(record));
  } catch (error) { res.status(Number(error.status)||400).json({ error: clean(error.message, 500) }); }
});
router.delete('/projects/:id', async (req, res) => {
  try {
    const id = safeId(req.params.id);
    if (!(await getType('project', id))) return res.status(404).json({ error: 'Project not found' });
    for (const type of ['scene','shootDay','callSheet','budgetItem','scriptNote']) {
      for (const record of await listType(type)) if (String(record.projectId) === id) await softDelete(type, record.id);
    }
    await softDelete('project', id);
    res.json({ ok: true, deleted: 'soft' });
  } catch (error) { res.status(Number(error.status)||500).json({ error: clean(error.message, 500) }); }
});

router.get('/characters', async (req, res) => {
  try {
    const query = clean(req.query.q, 200).toLowerCase();
    const rows = await listType('character');
    res.json(rows.filter(row => !query || [row.canonicalName, ...arr(row.aliases), ...arr(row.primaryStories), ...arr(row.scriptureReferences)].join(' ').toLowerCase().includes(query)).map(characterOut).sort((a,b)=>a.canonicalName.localeCompare(b.canonicalName)));
  } catch (error) { res.status(500).json({ error: 'Characters unavailable' }); }
});
router.get('/characters/:id', async (req, res) => {
  try { const row = await getType('character', req.params.id); if (!row) return res.status(404).json({ error: 'Character not found' }); res.json(characterOut(row)); }
  catch (error) { res.status(Number(error.status)||500).json({ error: clean(error.message, 500) }); }
});
router.post('/characters', async (req, res) => {
  try {
    const body = req.body || {}, canonicalName = clean(body.canonicalName || body.canonical_name, 180);
    if (!canonicalName) return res.status(400).json({ error: 'canonicalName is required' });
    const existing = (await listType('character')).find(row => row.canonicalName.toLowerCase() === canonicalName.toLowerCase());
    if (existing) return res.status(409).json({ error: 'Character already exists', id: existing.id });
    const id = body.id ? safeId(body.id) : idOf('character');
    const row = await saveType('character', id, { canonicalName, aliases: arr(body.aliases), primaryStories: arr(body.primaryStories), relationships: arr(body.relationships), keyTraits: arr(body.keyTraits), notes: clean(body.notes, 3000), scriptureReferences: arr(body.scriptureReferences) });
    res.status(201).json(characterOut(row));
  } catch (error) { res.status(Number(error.status)||400).json({ error: clean(error.message, 500) }); }
});
router.put('/characters/:id', async (req, res) => {
  try {
    const current = await getType('character', req.params.id);
    if (!current) return res.status(404).json({ error: 'Character not found' });
    const body = req.body || {}, canonicalName = clean(body.canonicalName ?? current.canonicalName, 180);
    if (!canonicalName) return res.status(400).json({ error: 'canonicalName is required' });
    const duplicate = (await listType('character')).find(row => row.id !== current.id && row.canonicalName.toLowerCase() === canonicalName.toLowerCase());
    if (duplicate) return res.status(409).json({ error: 'Character already exists', id: duplicate.id });
    const row = await saveType('character', current.id, { ...current, canonicalName, aliases: arr(body.aliases ?? current.aliases), primaryStories: arr(body.primaryStories ?? current.primaryStories), relationships: arr(body.relationships ?? current.relationships), keyTraits: arr(body.keyTraits ?? current.keyTraits), notes: clean(body.notes ?? current.notes, 3000), scriptureReferences: arr(body.scriptureReferences ?? current.scriptureReferences) });
    res.json(characterOut(row));
  } catch (error) { res.status(Number(error.status)||400).json({ error: clean(error.message, 500) }); }
});
router.delete('/characters/:id', async (req, res) => {
  try { const ok = await softDelete('character', req.params.id); if (!ok) return res.status(404).json({ error: 'Character not found' }); res.json({ ok: true, deleted: 'soft' }); }
  catch (error) { res.status(Number(error.status)||500).json({ error: clean(error.message, 500) }); }
});

router.get('/scenes', async (req, res) => {
  try {
    const projectId = req.query.projectId ? safeId(req.query.projectId) : null;
    const rows = await listType('scene');
    res.json(rows.filter(row => !projectId || String(row.projectId) === projectId).map(sceneOut).sort((a,b)=>String(a.projectId).localeCompare(String(b.projectId)) || a.sceneNumber-b.sceneNumber || a.id.localeCompare(b.id)));
  } catch (error) { res.status(Number(error.status)||500).json({ error: clean(error.message, 500) }); }
});
router.post('/scenes', async (req, res) => {
  try {
    const body = req.body || {}, projectId = await resolveProjectId(body.projectId);
    const scriptureReference = clean(body.scriptureReference || body.scriptureRef || body.scripture_ref, 120);
    if (!validRef(scriptureReference)) return res.status(400).json({ error: 'projectId and valid scriptureReference are required' });
    const id = body.id ? safeId(body.id) : idOf('scene');
    if (await getType('scene', id)) return res.status(409).json({ error: 'Scene already exists; use PUT to update it' });
    const characters = arr(body.characters || body.charactersPresent).map(x=>clean(x,180)).filter(Boolean);
    const row = await saveType('scene', id, { projectId, sceneNumber: Number(body.sceneNumber)||1, title: clean(body.title || ('Scene ' + (Number(body.sceneNumber)||1)),240), scriptureReference, location: clean(body.location,500), characters, charactersPresent: arr(body.charactersPresent || body.characters).map(x=>clean(x,180)).filter(Boolean), actionSummary: clean(body.actionSummary,4000), emotionalBeat: clean(body.emotionalBeat,2000), productionNotes: clean(body.productionNotes,4000), estimatedPages: Number.isFinite(Number(body.estimatedPages)) && body.estimatedPages!=='' ? Number(body.estimatedPages) : null, dayOrNight: clean(body.dayOrNight,80) });
    res.status(201).json(sceneOut(row));
  } catch (error) { res.status(Number(error.status)||400).json({ error: clean(error.message, 500) }); }
});
router.put('/scenes/:id', async (req, res) => {
  try {
    const current = await getType('scene', req.params.id);
    if (!current) return res.status(404).json({ error: 'Scene not found' });
    const body = req.body || {}, scriptureReference = clean(body.scriptureReference ?? body.scriptureRef ?? current.scriptureReference,120);
    if (!validRef(scriptureReference)) return res.status(400).json({ error: 'Valid scriptureReference is required' });
    const row = await saveType('scene', current.id, { ...current, sceneNumber: Number(body.sceneNumber ?? current.sceneNumber)||1, title: clean(body.title ?? current.title,240), scriptureReference, location: clean(body.location ?? current.location,500), characters: arr(body.characters ?? current.characters).map(x=>clean(x,180)).filter(Boolean), charactersPresent: arr(body.charactersPresent ?? body.characters ?? current.charactersPresent).map(x=>clean(x,180)).filter(Boolean), actionSummary: clean(body.actionSummary ?? current.actionSummary,4000), emotionalBeat: clean(body.emotionalBeat ?? current.emotionalBeat,2000), productionNotes: clean(body.productionNotes ?? current.productionNotes,4000), estimatedPages: (body.estimatedPages ?? current.estimatedPages) == null || (body.estimatedPages ?? current.estimatedPages) === '' ? null : (Number.isFinite(Number(body.estimatedPages ?? current.estimatedPages)) ? Number(body.estimatedPages ?? current.estimatedPages) : null), dayOrNight: clean(body.dayOrNight ?? current.dayOrNight,80) });
    res.json(sceneOut(row));
  } catch (error) { res.status(Number(error.status)||400).json({ error: clean(error.message, 500) }); }
});
router.delete('/scenes/:id', async (req, res) => {
  try { const ok = await softDelete('scene', req.params.id); if (!ok) return res.status(404).json({ error: 'Scene not found' }); res.json({ ok: true, deleted: 'soft' }); }
  catch (error) { res.status(Number(error.status)||500).json({ error: clean(error.message, 500) }); }
});
router.post('/scenes/generate', async (req, res) => {
  try {
    const body = req.body || {}, projectId = await resolveProjectId(body.projectId);
    const text = clean(body.text, 50000), scriptureReference = clean(body.scriptureReference || body.scriptureRef, 120);
    if (!text) return res.status(400).json({ error: 'projectId and scripture text are required' });
    if (!validRef(scriptureReference)) return res.status(400).json({ error: 'A valid scripture reference is required' });
    const existing = (await listType('scene')).filter(row=>String(row.projectId)===projectId);
    let number = existing.reduce((max,row)=>Math.max(max,Number(row.sceneNumber)||0),0);
    const parts = text.split(/\n\s*\n|(?<=[.!?])\s+(?=[A-Z])/).map(value=>value.trim()).filter(Boolean).slice(0,200);
    const characters = await listType('character');
    const generated = parts.map(part=>{
      number += 1;
      const matched = characters.filter(character=>[character.canonicalName,...arr(character.aliases)].some(name=>name && part.toLowerCase().includes(String(name).toLowerCase())));
      return sceneOut({
        id:'',recordType:'scene',projectId,sceneNumber:number,title:'Scene '+number+' — '+part.split(/\s+/).slice(0,6).join(' ').slice(0,80),
        scriptureReference,location:'To be determined',characters:matched.map(item=>item.canonicalName),
        charactersPresent:matched.map(item=>item.id),actionSummary:part,emotionalBeat:'Refine from the passage without inventing events.',
        productionNotes:'Verify the source passage, setting, costumes, props, continuity, and production requirements before approval.',
        estimatedPages:null,dayOrNight:''
      });
    });
    res.json(generated);
  } catch (error) { res.status(Number(error.status)||500).json({ error: clean(error.message, 500) }); }
});

router.get('/shoot-days', async (req, res) => {
  try { const projectId=req.query.projectId?safeId(req.query.projectId):null; res.json((await listType('shootDay')).filter(row=>!projectId||String(row.projectId)===projectId).map(shootDayOut).sort((a,b)=>String(a.date).localeCompare(String(b.date)))); }
  catch (error) { res.status(Number(error.status)||500).json({ error: clean(error.message,500) }); }
});
router.post('/shoot-days', async (req,res) => {
  try { const body=req.body||{}, projectId=await resolveProjectId(body.projectId), date=clean(body.date,10); if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return res.status(400).json({error:'projectId and YYYY-MM-DD date are required'}); const row=await saveType('shootDay',idOf('shootDay'),{projectId,date,unit:clean(body.unit||'1st Unit',80),notes:clean(body.notes,3000)}); res.status(201).json(shootDayOut(row)); }
  catch(error){res.status(Number(error.status)||400).json({error:clean(error.message,500)});}
});
router.post('/shoot-days/:id/scenes', async (req,res) => {
  try {
    const day=await getType('shootDay',req.params.id); if(!day)return res.status(404).json({error:'Shoot day not found'});
    for(const rawId of arr(req.body?.sceneIds)){const scene=await getType('scene',rawId);if(!scene||String(scene.projectId)!==String(day.projectId))continue;const relationId=String(day.id)+'-'+String(scene.id);const existing=await getType('sceneShootDay',relationId);if(!existing)await saveType('sceneShootDay',relationId,{shootDayId:String(day.id),sceneId:String(scene.id)});}
    res.json({ok:true});
  } catch(error){res.status(Number(error.status)||400).json({error:clean(error.message,500)});}
});
router.get('/shoot-days/:id/scenes', async (req,res) => {
  try {const day=await getType('shootDay',req.params.id);if(!day)return res.status(404).json({error:'Shoot day not found'});const links=(await listType('sceneShootDay')).filter(x=>String(x.shootDayId)===String(day.id));const ids=new Set(links.map(x=>String(x.sceneId)));res.json((await listType('scene')).filter(x=>ids.has(String(x.id))).map(sceneOut).sort((a,b)=>a.sceneNumber-b.sceneNumber));}
  catch(error){res.status(Number(error.status)||500).json({error:clean(error.message,500)});}
});

router.get('/call-sheets', async (req,res) => {
  try {const projectId=req.query.projectId?safeId(req.query.projectId):null;res.json((await listType('callSheet')).filter(x=>!projectId||String(x.projectId)===projectId).map(callSheetOut).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))));}
  catch(error){res.status(Number(error.status)||500).json({error:clean(error.message,500)});}
});
async function makeCallSheet(body={}, forcedId=null) {
  const sceneIds=arr(body.sceneIds).map(value=>clean(value,128)).filter(Boolean);
  const linked=[];
  for(const id of sceneIds){const scene=await getType('scene',id);if(scene)linked.push(sceneOut(scene));}
  const projectId=await resolveProjectId(body.projectId || linked[0]?.projectId);
  if(linked.some(scene=>String(scene.projectId)!==String(projectId)))throw Object.assign(new Error('Call sheet scenes must belong to the selected project'),{status:400});
  const characters=arr(body.characters).map(value=>clean(value,180)).filter(Boolean);
  const locations=arr(body.locations).map(value=>clean(value,500)).filter(Boolean);
  const uniqueLocations=[...new Set([...locations,...linked.map(scene=>scene.location).filter(Boolean)])];
  const linkedCharacters=[...new Set([...characters,...linked.flatMap(scene=>scene.characters)])];
  const crew=arr(body.crew).length?arr(body.crew):['Director','1st AD','Director of Photography','Sound','Art / Props','Wardrobe','Script Supervisor'];
  const callTimes=decObject(body.callTimes || {crew:'05:00',cast:'06:00'});
  return saveType('callSheet',forcedId||idOf('callSheet'),{
    projectId,shootDate:clean(body.shootDate || new Date().toISOString().slice(0,10),10),
    generalCallTime:clean(body.generalCallTime||callTimes.crew||'05:00',20),
    weatherNotes:clean(body.weatherNotes,2000),specialRequirements:clean(body.specialRequirements,3000),
    crew,cast:arr(body.cast).length?arr(body.cast):linkedCharacters,locations:uniqueLocations,
    characters:linkedCharacters,callTimes,sceneIds:linked.map(scene=>scene.id),shootDayId:body.shootDayId?clean(body.shootDayId,128):null
  });
}
router.post('/call-sheets/from-scenes', async (req,res) => {
  try {const ids=arr(req.body?.sceneIds);if(!ids.length)return res.status(400).json({error:'sceneIds is required'});const existing=[];for(const id of ids){const scene=await getType('scene',id);if(scene)existing.push(scene);}if(!existing.length)return res.status(404).json({error:'No linked scenes found'});if(existing.length!==ids.length)return res.status(400).json({error:'One or more linked scenes were not found'});res.status(201).json(callSheetOut(await makeCallSheet(req.body||{})));}
  catch(error){res.status(Number(error.status)||400).json({error:clean(error.message,500)});}
});
router.post('/call-sheets', async (req,res) => {
  try {res.status(201).json(callSheetOut(await makeCallSheet(req.body||{})));}
  catch(error){res.status(Number(error.status)||400).json({error:clean(error.message,500)});}
});
router.put('/call-sheets/:id', async (req,res) => {
  try {if(!(await getType('callSheet',req.params.id)))return res.status(404).json({error:'Call sheet not found'});res.json(callSheetOut(await makeCallSheet(req.body||{},safeId(req.params.id))));}
  catch(error){res.status(Number(error.status)||400).json({error:clean(error.message,500)});}
});
router.delete('/call-sheets/:id', async (req,res) => {
  try {const ok=await softDelete('callSheet',req.params.id);if(!ok)return res.status(404).json({error:'Call sheet not found'});res.json({ok:true,deleted:'soft'});}
  catch(error){res.status(Number(error.status)||500).json({error:clean(error.message,500)});}
});
router.get('/call-sheets/:id/pdf', async (req,res) => {
  try {
    const stored=await getType('callSheet',req.params.id);if(!stored)return res.status(404).json({error:'Call sheet not found'});
    const sheet=callSheetOut(stored);
    const lines=['KERNELVISION · BIBLE PRODUCTION — CALL SHEET','Shoot date: '+sheet.shootDate,'Project: '+String((await getType('project',sheet.projectId))?.title||''),'Locations: '+sheet.locations.join(', '),'Characters: '+sheet.characters.join(', '),'Crew: '+sheet.crew.join(', '),'Call times: '+JSON.stringify(sheet.callTimes),'Weather: '+sheet.weatherNotes,'Special requirements: '+sheet.specialRequirements,'Linked scenes: '+sheet.sceneIds.join(', ')];
    const esc=value=>String(value).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
    const body=['BT','/F1 18 Tf','50 760 Td',...lines.flatMap((value,index)=>(index?['0 -22 Td']:[]).concat(['('+esc(value).slice(0,110)+') Tj'])),'ET'].join('\n');
    const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+body.length+' >>\nstream\n'+body+'\nendstream'];
    let pdf='%PDF-1.4\n';const offsets=[0];for(let i=0;i<objects.length;i++){offsets[i+1]=Buffer.byteLength(pdf);pdf+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n';}
    const xref=Buffer.byteLength(pdf);pdf+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n';for(let i=1;i<offsets.length;i++)pdf+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';pdf+='trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';
    const buffer=Buffer.from(pdf);res.set({'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="kernelvision-call-sheet.pdf"','Content-Length':buffer.length});res.send(buffer);
  } catch(error){res.status(500).json({error:'Call sheet PDF unavailable'});}
});

router.get('/budget', async (req,res) => {
  try {const projectId=req.query.projectId?safeId(req.query.projectId):null;res.json((await listType('budgetItem')).filter(x=>!projectId||String(x.projectId)===projectId).map(budgetOut).sort((a,b)=>String(a.category).localeCompare(String(b.category))));}
  catch(error){res.status(Number(error.status)||500).json({error:clean(error.message,500)});}
});
router.post('/budget', async (req,res) => {
  try {const body=req.body||{},projectId=await resolveProjectId(body.projectId),category=clean(body.category,120),description=clean(body.description,1000);if(!category||!description)return res.status(400).json({error:'category and description are required'});const row=await saveType('budgetItem',idOf('budgetItem'),{projectId,category,description,estimated:Number(body.estimated)||0,actual:Number(body.actual)||0,notes:clean(body.notes,3000)});res.status(201).json(budgetOut(row));}
  catch(error){res.status(Number(error.status)||400).json({error:clean(error.message,500)});}
});
router.delete('/budget/:id', async (req,res) => {
  try {const ok=await softDelete('budgetItem',req.params.id);if(!ok)return res.status(404).json({error:'Budget item not found'});res.json({ok:true,deleted:'soft'});}
  catch(error){res.status(Number(error.status)||500).json({error:clean(error.message,500)});}
});

router.get('/script-notes', async (req,res) => {
  try {const projectId=req.query.projectId?safeId(req.query.projectId):null;res.json((await listType('scriptNote')).filter(x=>!projectId||String(x.projectId)===projectId).map(noteOut).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))));}
  catch(error){res.status(Number(error.status)||500).json({error:clean(error.message,500)});}
});
router.post('/script-notes', async (req,res) => {
  try {const body=req.body||{},projectId=await resolveProjectId(body.projectId),scriptureReference=clean(body.scriptureReference||body.scriptureRef,120);if(!validRef(scriptureReference))return res.status(400).json({error:'valid scriptureReference is required'});const row=await saveType('scriptNote',idOf('scriptNote'),{projectId,sceneId:body.sceneId?safeId(body.sceneId):null,scriptureReference,dialogue:clean(body.dialogue,6000),versionNotes:clean(body.versionNotes,4000)});res.status(201).json(noteOut(row));}
  catch(error){res.status(Number(error.status)||400).json({error:clean(error.message,500)});}
});
router.get('/script-notes/:id', async (req,res) => {
  try {const row=await getType('scriptNote',req.params.id);if(!row)return res.status(404).json({error:'Script note not found'});res.json(noteOut(row));}
  catch(error){res.status(Number(error.status)||500).json({error:clean(error.message,500)});}
});

export default router;
