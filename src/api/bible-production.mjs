import express from 'express';
import pg from 'pg';
import crypto from 'node:crypto';
import { BIBLE_CHARACTER_SEEDS } from '../data/bible-characters.mjs';

const { Pool } = pg;
const router = express.Router();
let pool;

function db() {
  if (!String(process.env.DATABASE_URL || '').trim()) throw new Error('DATABASE_URL is required');
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
  return pool;
}
const json = (value, fallback = []) => {
  if (Array.isArray(value) || (value && typeof value === 'object')) return value;
  try { return JSON.parse(value || JSON.stringify(fallback)); } catch { return fallback; }
};
const arr = value => Array.isArray(value) ? value : [];
const ref = value => /^[1-3]?\s?[A-Za-z]+(?:\s+[A-Za-z]+)*\s+\d+:\d+(?:-\d+)?$/.test(String(value || '').trim());
const project = r => r ? ({ ...r, primaryScripture: r.primary_scripture }) : r;
const character = r => r && ({ ...r, aliases: json(r.aliases), primaryStories: json(r.primary_stories), relationships: json(r.relationships), keyTraits: json(r.key_traits), scriptureReferences: json(r.scripture_references) });
const scene = r => r && ({ ...r, charactersPresent: json(r.characters_present) });
const sheet = r => r && ({ ...r, crew: json(r.crew), cast: json(r.cast), locations: json(r.locations), characters: json(r.characters), callTimes: json(r.call_times, {}), sceneIds: json(r.scene_ids) });

async function seedCharacters() {
  const count = await db().query('SELECT COUNT(*)::int AS n FROM characters');
  if (count.rows[0].n) return;
  for (const c of BIBLE_CHARACTER_SEEDS) {
    await db().query(`INSERT INTO characters(canonical_name,aliases,primary_stories,relationships,key_traits,notes,scripture_references)
      VALUES($1,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7::jsonb)
      ON CONFLICT (canonical_name) DO NOTHING`,
      [c.canonicalName, JSON.stringify(c.aliases), JSON.stringify(c.primaryStories), JSON.stringify(c.relationships), JSON.stringify(c.keyTraits), c.notes || '', JSON.stringify(c.scriptureReferences)]);
  }
}

router.use(async (_req, _res, next) => {
  try { await seedCharacters(); next(); } catch (error) { next(error); }
});

router.get('/projects', async (_req, res) => {
  const { rows } = await db().query(`SELECT p.*, COUNT(DISTINCT sc.id)::int scene_count, COUNT(DISTINCT sd.id)::int shoot_day_count
    FROM projects p LEFT JOIN scenes sc ON sc.project_id=p.id LEFT JOIN shoot_days sd ON sd.project_id=p.id
    GROUP BY p.id ORDER BY p.updated_at DESC`);
  res.json(rows.map(project));
});
router.post('/projects', async (req, res) => {
  const title = String(req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'title is required' });
  const { rows } = await db().query('INSERT INTO projects(title,description,primary_scripture,status) VALUES($1,$2,$3,$4) RETURNING *',
    [title, String(req.body.description || ''), String(req.body.primaryScripture || ''), String(req.body.status || 'development')]);
  res.status(201).json(project(rows[0]));
});
router.put('/projects/:id', async (req, res) => {
  const { rows } = await db().query('UPDATE projects SET title=$1,description=$2,primary_scripture=$3,status=$4,updated_at=NOW() WHERE id=$5 RETURNING *',
    [String(req.body.title || '').trim(), String(req.body.description || ''), String(req.body.primaryScripture || ''), String(req.body.status || 'development'), req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Project not found' });
  res.json(project(rows[0]));
});
router.delete('/projects/:id', async (req, res) => {
  const r = await db().query('DELETE FROM projects WHERE id=$1', [req.params.id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Project not found' });
  res.json({ ok: true });
});

router.get('/characters', async (req, res) => {
  const q = String(req.query.q || '');
  const { rows } = await db().query(q
    ? 'SELECT * FROM characters WHERE canonical_name ILIKE $1 OR aliases::text ILIKE $1 OR primary_stories::text ILIKE $1 ORDER BY canonical_name'
    : 'SELECT * FROM characters ORDER BY canonical_name', q ? [`%${q}%`] : []);
  res.json(rows.map(character));
});
router.get('/characters/:id', async (req, res) => {
  const { rows } = await db().query('SELECT * FROM characters WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Character not found' });
  res.json(character(rows[0]));
});
router.post('/characters', async (req, res) => {
  const b = req.body || {};
  if (!String(b.canonicalName || '').trim()) return res.status(400).json({ error: 'canonicalName is required' });
  const { rows } = await db().query(`INSERT INTO characters(canonical_name,aliases,primary_stories,relationships,key_traits,notes,scripture_references)
    VALUES($1,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7::jsonb) RETURNING *`,
    [String(b.canonicalName).trim(), JSON.stringify(arr(b.aliases)), JSON.stringify(arr(b.primaryStories)), JSON.stringify(arr(b.relationships)), JSON.stringify(arr(b.keyTraits)), String(b.notes || ''), JSON.stringify(arr(b.scriptureReferences))]);
  res.status(201).json(character(rows[0]));
});
router.put('/characters/:id', async (req, res) => {
  const b = req.body || {};
  const { rows } = await db().query(`UPDATE characters SET canonical_name=$1,aliases=$2::jsonb,primary_stories=$3::jsonb,relationships=$4::jsonb,key_traits=$5::jsonb,notes=$6,scripture_references=$7::jsonb WHERE id=$8 RETURNING *`,
    [String(b.canonicalName || '').trim(), JSON.stringify(arr(b.aliases)), JSON.stringify(arr(b.primaryStories)), JSON.stringify(arr(b.relationships)), JSON.stringify(arr(b.keyTraits)), String(b.notes || ''), JSON.stringify(arr(b.scriptureReferences)), req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Character not found' });
  res.json(character(rows[0]));
});
router.delete('/characters/:id', async (req, res) => {
  const r = await db().query('DELETE FROM characters WHERE id=$1', [req.params.id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Character not found' });
  res.json({ ok: true });
});

router.get('/scenes', async (req, res) => {
  const { rows } = await db().query(req.query.projectId
    ? 'SELECT * FROM scenes WHERE project_id=$1 ORDER BY scene_number,id'
    : 'SELECT * FROM scenes ORDER BY project_id,scene_number,id', req.query.projectId ? [req.query.projectId] : []);
  res.json(rows.map(scene));
});
router.post('/scenes', async (req, res) => {
  const b = req.body || {};
  if (!b.projectId || !ref(b.scriptureRef)) return res.status(400).json({ error: 'projectId and valid scriptureRef are required' });
  const { rows } = await db().query(`INSERT INTO scenes(project_id,scene_number,title,scripture_ref,location,characters_present,action_summary,emotional_beat,production_notes,estimated_pages,day_or_night)
    VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11) RETURNING *`,
    [b.projectId, Number(b.sceneNumber) || null, String(b.title || ''), b.scriptureRef, String(b.location || ''), JSON.stringify(arr(b.charactersPresent)), String(b.actionSummary || ''), String(b.emotionalBeat || ''), String(b.productionNotes || ''), Number(b.estimatedPages) || null, String(b.dayOrNight || '')]);
  res.status(201).json(scene(rows[0]));
});
router.put('/scenes/:id', async (req, res) => {
  const b = req.body || {};
  const { rows } = await db().query(`UPDATE scenes SET scene_number=$1,title=$2,scripture_ref=$3,location=$4,characters_present=$5::jsonb,action_summary=$6,emotional_beat=$7,production_notes=$8,estimated_pages=$9,day_or_night=$10 WHERE id=$11 RETURNING *`,
    [Number(b.sceneNumber) || null, String(b.title || ''), b.scriptureRef, String(b.location || ''), JSON.stringify(arr(b.charactersPresent)), String(b.actionSummary || ''), String(b.emotionalBeat || ''), String(b.productionNotes || ''), Number(b.estimatedPages) || null, String(b.dayOrNight || ''), req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Scene not found' });
  res.json(scene(rows[0]));
});
router.delete('/scenes/:id', async (req, res) => {
  const r = await db().query('DELETE FROM scenes WHERE id=$1', [req.params.id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Scene not found' });
  res.json({ ok: true });
});
router.post('/scenes/generate', async (req, res) => {
  const b = req.body || {};
  if (!b.projectId || !String(b.text || '').trim()) return res.status(400).json({ error: 'projectId and scripture text are required' });
  const { rows: chars } = await db().query('SELECT * FROM characters');
  const parts = String(b.text).split(/\n\s*\n|(?<=[.!?])\s+(?=[A-Z])/).map(x => x.trim()).filter(Boolean);
  const { rows: maxRows } = await db().query('SELECT COALESCE(MAX(scene_number),0)::int n FROM scenes WHERE project_id=$1', [b.projectId]);
  const n = maxRows[0]?.n || 0;
  res.json({ method: 'deterministic-fallback', scenes: parts.map((t, i) => ({
    projectId: b.projectId, sceneNumber: n + i + 1, title: 'Scene ' + (n + i + 1), scriptureRef: b.scriptureRef || 'Genesis 1:1',
    location: 'To be determined',
    charactersPresent: chars.filter(c => (c.canonical_name + ' ' + json(c.aliases).join(' ')).toLowerCase().split(/\s+/).some(k => k.length > 2 && t.toLowerCase().includes(k))).map(c => c.id),
    actionSummary: t, emotionalBeat: 'Refine from the passage without inventing events.',
    productionNotes: 'Verify scripture reference, setting, costumes, props, continuity, and production requirements.'
  })) });
});

router.get('/shoot-days', async (req, res) => {
  const { rows } = await db().query(req.query.projectId ? 'SELECT * FROM shoot_days WHERE project_id=$1 ORDER BY date,id' : 'SELECT * FROM shoot_days ORDER BY date,id', req.query.projectId ? [req.query.projectId] : []);
  res.json(rows);
});
router.post('/shoot-days', async (req, res) => {
  const b = req.body || {};
  if (!b.projectId || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.date || ''))) return res.status(400).json({ error: 'projectId and YYYY-MM-DD date are required' });
  const { rows } = await db().query('INSERT INTO shoot_days(project_id,date,unit,notes) VALUES($1,$2,$3,$4) RETURNING *', [b.projectId,b.date,String(b.unit || '1st Unit'),String(b.notes || '')]);
  res.status(201).json(rows[0]);
});
router.post('/shoot-days/:id/scenes', async (req, res) => {
  const ids = arr(req.body?.sceneIds).map(Number).filter(Boolean);
  for (const id of ids) await db().query(`INSERT INTO shoot_day_scenes(scene_id,shoot_day_id,project_id,shoot_date,position)
    SELECT s.id,sd.id,sd.project_id,sd.date,COALESCE((SELECT MAX(position)+1 FROM shoot_day_scenes WHERE shoot_day_id=sd.id),0)
    FROM scenes s JOIN shoot_days sd ON sd.id=$2 WHERE s.id=$1 ON CONFLICT (scene_id) DO UPDATE SET shoot_day_id=EXCLUDED.shoot_day_id,project_id=EXCLUDED.project_id,shoot_date=EXCLUDED.shoot_date`, [id, req.params.id]);
  res.json({ ok: true });
});
router.get('/shoot-days/:id/scenes', async (req, res) => {
  const { rows } = await db().query('SELECT s.* FROM scenes s JOIN shoot_day_scenes m ON m.scene_id=s.id WHERE m.shoot_day_id=$1 ORDER BY m.position,s.scene_number,s.id', [req.params.id]);
  res.json(rows.map(scene));
});

router.get('/call-sheets', async (_req, res) => {
  const { rows } = await db().query('SELECT * FROM call_sheets ORDER BY id DESC');
  res.json(rows.map(sheet));
});
router.post('/call-sheets/from-scenes', async (req, res) => {
  const b = req.body || {};
  const ids = arr(b.sceneIds).map(Number).filter(Boolean);
  if (!ids.length) return res.status(400).json({ error: 'sceneIds is required' });
  const { rows } = await db().query('SELECT * FROM scenes WHERE id=ANY($1::int[]) ORDER BY scene_number,id', [ids]);
  if (!rows.length) return res.status(404).json({ error: 'No linked scenes found' });
  const locations = [...new Set(rows.map(x => x.location).filter(Boolean))];
  const characters = [...new Set(rows.flatMap(x => json(x.characters_present)))];
  const crew = ['Director','1st AD','Director of Photography','Sound','Art / Props','Wardrobe','Script Supervisor'];
  const times = b.callTimes || { crew: '05:00', cast: '06:00' };
  const shootDate = String(b.shootDate || new Date().toISOString().slice(0,10));
  const shootDay = b.shootDayId ? String(b.shootDayId) : null;
  const { rows: created } = await db().query(`INSERT INTO call_sheets(shoot_day_id,general_call_time,weather_notes,special_requirements,crew,cast,locations,characters,call_times,scene_ids)
    VALUES(COALESCE($1,(SELECT id FROM shoot_days WHERE project_id=$2 AND date=$3 LIMIT 1)), $4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb) RETURNING *`,
    [shootDay,b.projectId || null,shootDate,b.generalCallTime || '05:00',String(b.weatherNotes || ''),String(b.specialRequirements || ''),JSON.stringify(crew),JSON.stringify(characters),JSON.stringify(locations),JSON.stringify(characters),JSON.stringify(times),JSON.stringify(ids)]);
  if (!created[0]) return res.status(400).json({ error: 'A shoot day is required for a call sheet' });
  res.status(201).json(sheet(created[0]));
});
router.get('/call-sheets/:id/pdf', async (req, res) => {
  const { rows } = await db().query('SELECT * FROM call_sheets WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Call sheet not found' });
  const c = sheet(rows[0]);
  const lines = ['APEX BIBLE STORY STUDIO — CALL SHEET','Shoot date: '+(rows[0].shoot_date || ''),'Locations: '+c.locations.join(', '),'Characters: '+c.characters.join(', '),'Crew: '+c.crew.join(', '),'Call times: '+JSON.stringify(c.callTimes),'Weather: '+(c.weather_notes || ''),'Special requirements: '+(c.special_requirements || ''),'Linked scenes: '+c.sceneIds.join(', ')];
  const esc = v => String(v).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
  const body = ['BT','/F1 18 Tf','50 760 Td',...lines.flatMap((v,i)=>(i?['0 -22 Td']:[]).concat(['('+esc(v).slice(0,110)+') Tj'])),'ET'].join('\n');
  const objs=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+body.length+' >>\nstream\n'+body+'\nendstream'];
  let pdf='%PDF-1.4\n',offs=[0];
  for(let i=0;i<objs.length;i++){offs[i+1]=Buffer.byteLength(pdf);pdf+=(i+1)+' 0 obj\n'+objs[i]+'\nendobj\n';}
  const xref=Buffer.byteLength(pdf);pdf+='xref\n0 '+(objs.length+1)+'\n0000000000 65535 f \n';
  for(let i=1;i<offs.length;i++)pdf+=String(offs[i]).padStart(10,'0')+' 00000 n \n';
  pdf+='trailer\n<< /Size '+(objs.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';
  const buf=Buffer.from(pdf);
  res.set({'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="apex-call-sheet.pdf"','Content-Length':buf.length});
  res.send(buf);
});

router.get('/budget', async (req,res) => { const {rows}=await db().query('SELECT * FROM budget_items WHERE project_id=$1 ORDER BY category,id',[req.query.projectId]); res.json(rows); });
router.post('/budget', async (req,res) => { const b=req.body||{}; const {rows}=await db().query('INSERT INTO budget_items(project_id,category,description,estimated,actual,notes) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[b.projectId,b.category,b.description,Number(b.estimated)||0,Number(b.actual)||0,String(b.notes||'')]); res.status(201).json(rows[0]); });
router.get('/script-notes', async (req,res) => { const {rows}=await db().query('SELECT * FROM script_notes WHERE project_id=$1 ORDER BY id DESC',[req.query.projectId]); res.json(rows); });
router.post('/script-notes', async (req,res) => { const b=req.body||{}; if(!b.projectId||!ref(b.scriptureRef)) return res.status(400).json({error:'projectId and valid scriptureRef are required'}); const {rows}=await db().query('INSERT INTO script_notes(project_id,scene_id,scripture_ref,dialogue,version_notes) VALUES($1,$2,$3,$4,$5) RETURNING *',[b.projectId,b.sceneId||null,b.scriptureRef,String(b.dialogue||''),String(b.versionNotes||'')]); res.status(201).json(rows[0]); });

export default router;
