import sqlite3 from "sqlite3";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";

const file = path.resolve(workerData.file);
const busyTimeout = Math.max(5000, Math.min(120000, Number(workerData.busyTimeout ?? 60000)));
let db;
const prepared = new Map();

const json = (v, fallback = null) => v == null ? fallback : JSON.stringify(v);
const parse = (v, fallback = null) => {
  if (v == null || v === "") return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
};

function run(sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params, function(error) {
    if (error) return reject(error);
    resolve({ changes: this.changes, lastID: this.lastID });
  }));
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row ?? null)));
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows ?? [])));
}
function exec(sql) {
  return new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()));
}
function closeDb() {
  return new Promise((resolve, reject) => db?.close(error => error ? reject(error) : resolve()));
}

async function columns(table) {
  return all("PRAGMA table_info(" + table + ")").then(rows => new Set(rows.map(x => x.name)));
}

async function migrate() {
  const production = await columns("production_timelines").catch(() => new Set());
  const mutations = await columns("timeline_mutations").catch(() => new Set());
  const narrative = await columns("narrative_tracks").catch(() => new Set());
  const voice = await columns("voice_assets").catch(() => new Set());
  const runs = await columns("search_runs").catch(() => new Set());
  const results = await columns("search_results").catch(() => new Set());

  await exec(`
    CREATE TABLE IF NOT EXISTS production_timelines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id TEXT NOT NULL UNIQUE,
      scene_label TEXT NOT NULL,
      timecode TEXT NOT NULL,
      aesthetic_profile TEXT,
      prompt TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_production_timelines_scene ON production_timelines(scene_label);
    CREATE INDEX IF NOT EXISTS idx_production_timelines_timecode ON production_timelines(timecode);
    CREATE INDEX IF NOT EXISTS idx_production_timelines_node ON production_timelines(node_id);

    CREATE TABLE IF NOT EXISTS timeline_mutations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_node_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(parent_node_id) REFERENCES production_timelines(node_id) ON UPDATE CASCADE ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_timeline_mutations_parent ON timeline_mutations(parent_node_id);
    CREATE INDEX IF NOT EXISTS idx_timeline_mutations_branch ON timeline_mutations(branch_id);

    CREATE TABLE IF NOT EXISTS search_runs (
      id TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      mode TEXT,
      started_at TEXT,
      finished_at TEXT,
      status TEXT,
      sources TEXT,
      results TEXT
    );
    CREATE TABLE IF NOT EXISTS search_results (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      url TEXT NOT NULL,
      status INTEGER,
      content_type TEXT,
      created_at TEXT,
      FOREIGN KEY(run_id) REFERENCES search_runs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_search_results_run ON search_results(run_id);

    CREATE TABLE IF NOT EXISTS search_run_fragments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      fragment_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(run_id) REFERENCES search_runs(id) ON DELETE CASCADE,
      UNIQUE(run_id, fragment_index)
    );
    CREATE INDEX IF NOT EXISTS idx_search_run_fragments_run_position ON search_run_fragments(run_id, fragment_index);

    CREATE TABLE IF NOT EXISTS parsed_passage_fragments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT,
      result_id TEXT,
      fragment_index INTEGER NOT NULL,
      char_offset INTEGER NOT NULL DEFAULT 0,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(run_id) REFERENCES search_runs(id) ON DELETE CASCADE,
      FOREIGN KEY(result_id) REFERENCES search_results(id) ON DELETE CASCADE,
      UNIQUE(result_id, fragment_index)
    );
    CREATE INDEX IF NOT EXISTS idx_parsed_passage_run ON parsed_passage_fragments(run_id);
    CREATE INDEX IF NOT EXISTS idx_parsed_passage_result ON parsed_passage_fragments(result_id);
    CREATE INDEX IF NOT EXISTS idx_parsed_passage_position ON parsed_passage_fragments(result_id, fragment_index);
    CREATE VIRTUAL TABLE IF NOT EXISTS parsed_passage_fragments_fts
      USING fts5(text, content='parsed_passage_fragments', content_rowid='id');
    CREATE TRIGGER IF NOT EXISTS parsed_passage_fragments_ai AFTER INSERT ON parsed_passage_fragments BEGIN
      INSERT INTO parsed_passage_fragments_fts(rowid, text) VALUES (new.id, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS parsed_passage_fragments_ad AFTER DELETE ON parsed_passage_fragments BEGIN
      INSERT INTO parsed_passage_fragments_fts(parsed_passage_fragments_fts,rowid,text)
      VALUES ('delete', old.id, old.text);
    END;
    CREATE TRIGGER IF NOT EXISTS parsed_passage_fragments_au AFTER UPDATE OF text ON parsed_passage_fragments BEGIN
      INSERT INTO parsed_passage_fragments_fts(parsed_passage_fragments_fts,rowid,text)
      VALUES ('delete', old.id, old.text);
      INSERT INTO parsed_passage_fragments_fts(rowid,text) VALUES (new.id,new.text);
    END;

    CREATE TABLE IF NOT EXISTS narrative_tracks (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      branch_id TEXT,
      timeline_id TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS narrative_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      block_type TEXT,
      text_ref TEXT,
      visual_ref TEXT,
      vocal_ref TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(track_id) REFERENCES narrative_tracks(id) ON DELETE CASCADE,
      UNIQUE(track_id, position)
    );
    CREATE INDEX IF NOT EXISTS idx_narrative_blocks_track_position ON narrative_blocks(track_id, position);

    CREATE TABLE IF NOT EXISTS voice_assets (
      id TEXT PRIMARY KEY,
      track_id TEXT,
      playback_uri TEXT,
      media_uri TEXT,
      asset_id TEXT,
      content_type TEXT,
      content_length INTEGER,
      content_hash TEXT,
      metadata TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS production_timeline_audio_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timeline_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      position INTEGER NOT NULL,
      FOREIGN KEY(timeline_id) REFERENCES production_timelines(node_id) ON DELETE CASCADE,
      UNIQUE(timeline_id, position)
    );
    CREATE INDEX IF NOT EXISTS idx_production_timeline_audio_tags_timeline_position
      ON production_timeline_audio_tags(timeline_id, position);

    CREATE TABLE IF NOT EXISTS timeline_mutation_visual (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mutation_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      value TEXT NOT NULL,
      FOREIGN KEY(mutation_id) REFERENCES timeline_mutations(id) ON DELETE CASCADE,
      UNIQUE(mutation_id, position)
    );
    CREATE INDEX IF NOT EXISTS idx_timeline_mutation_visual_mutation_position
      ON timeline_mutation_visual(mutation_id, position);

    CREATE TABLE IF NOT EXISTS timeline_mutation_vocal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mutation_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      value TEXT NOT NULL,
      FOREIGN KEY(mutation_id) REFERENCES timeline_mutations(id) ON DELETE CASCADE,
      UNIQUE(mutation_id, position)
    );
    CREATE INDEX IF NOT EXISTS idx_timeline_mutation_vocal_mutation_position
      ON timeline_mutation_vocal(mutation_id, position);
  `);

  if (results.has("text")) {
    const legacy = await all("SELECT id, run_id, text FROM search_results WHERE text IS NOT NULL AND length(text)>0");
    for (const row of legacy) {
      const chunks = String(row.text).match(/[\\s\\S]{1,4000}/g) ?? [];
      for (let i=0;i<chunks.length;i++) await run(
        "INSERT OR IGNORE INTO parsed_passage_fragments(run_id,result_id,fragment_index,char_offset,text) VALUES(?,?,?,?,?)",
        [row.run_id,row.id,i,i*4000,chunks[i]]
      );
    }
  }
  if (runs.has("fragments")) {
    const legacy = await all("SELECT id, fragments FROM search_runs WHERE fragments IS NOT NULL AND fragments<>''");
    for (const row of legacy) {
      const parts = parse(row.fragments, []);
      if (Array.isArray(parts)) for (let i=0;i<parts.length;i++) {
        await run("INSERT OR IGNORE INTO search_run_fragments(run_id,fragment_index,text) VALUES(?,?,?)",[row.id,i,String(parts[i])]);
      }
    }
  }
  if (production.has("audio_tags")) {
    const rows = await all("SELECT node_id,audio_tags FROM production_timelines WHERE audio_tags IS NOT NULL");
    for (const row of rows) {
      const tags=parse(row.audio_tags,[]);
      if (Array.isArray(tags)) for (let i=0;i<tags.length;i++)
        await run("INSERT OR IGNORE INTO production_timeline_audio_tags(timeline_id,tag,position) VALUES(?,?,?)",[row.node_id,String(tags[i]),i]);
  }
  if (mutations.has("altered_visual") || mutations.has("altered_vocal")) {
    const rows = await all("SELECT id,altered_visual,altered_vocal FROM timeline_mutations");
    for (const row of rows) {
      const visual=parse(row.altered_visual,[]); const vocal=parse(row.altered_vocal,[]);
      if (Array.isArray(visual)) for (let i=0;i<visual.length;i++)
        await run("INSERT OR IGNORE INTO timeline_mutation_visual(mutation_id,position,value) VALUES(?,?,?)",[row.id,i,json(visual[i],null)]);
      if (Array.isArray(vocal)) for (let i=0;i<vocal.length;i++)
        await run("INSERT OR IGNORE INTO timeline_mutation_vocal(mutation_id,position,value) VALUES(?,?,?)",[row.id,i,json(vocal[i],null)]);
    }
  }
  if (narrative.has("blocks")) {
    const rows = await all("SELECT id,blocks FROM narrative_tracks WHERE blocks IS NOT NULL");
    for (const row of rows) {
      const blocks=parse(row.blocks,[]);
      if (Array.isArray(blocks)) for (let i=0;i<blocks.length;i++) {
        const b=blocks[i]??{};
        await run("INSERT OR IGNORE INTO narrative_blocks(track_id,position,block_type,text_ref,visual_ref,vocal_ref) VALUES(?,?,?,?,?,?)",
          [row.id,i,b.type??null,json(b.text,null),json(b.visualFrames??b.visual??null,null),json(b.vocal??null,null)]);
      }
    }
  }
  const legacyVoice = voice.has("filepath") ? await all("SELECT id,track_id,filepath,content_type,content_length,content_hash,metadata,created_at FROM voice_assets") : [];

  const rebuild = async (table, columnsSql, selectSql) => {
    await exec("PRAGMA foreign_keys=OFF");
    await run("BEGIN");
    try {
      await run("DROP TABLE IF EXISTS "+table+"_legacy");
      await run("ALTER TABLE "+table+" RENAME TO "+table+"_legacy");
      await run("CREATE TABLE "+table+" ("+columnsSql+")");
      await run("INSERT INTO "+table+" "+selectSql+" FROM "+table+"_legacy");
      await run("DROP TABLE "+table+"_legacy");
      await run("COMMIT");
    } catch (e) { await run("ROLLBACK").catch(()=>{}); throw e; }
    finally { await exec("PRAGMA foreign_keys=ON"); }
  };

  if (mutations.has("altered_visual") || mutations.has("altered_vocal")) await rebuild("timeline_mutations",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,node_id TEXT NOT NULL UNIQUE,scene_label TEXT NOT NULL,timecode TEXT NOT NULL,aesthetic_profile TEXT,prompt TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
    "(id,node_id,scene_label,timecode,aesthetic_profile,prompt,created_at,updated_at) SELECT id,node_id,scene_label,timecode,aesthetic_profile,prompt,created_at,updated_at");
  if (narrative.has("blocks")) await rebuild("narrative_tracks",
    "id TEXT PRIMARY KEY,project_id TEXT,branch_id TEXT,timeline_id TEXT,created_at TEXT",
    "(id,project_id,branch_id,timeline_id,created_at) SELECT id,project_id,branch_id,timeline_id,created_at");
  if (voice.has("filepath")) await rebuild("voice_assets",
    "id TEXT PRIMARY KEY,track_id TEXT,playback_uri TEXT,media_uri TEXT,asset_id TEXT,content_type TEXT,content_length INTEGER,content_hash TEXT,metadata TEXT,created_at TEXT",
    "(id,track_id,playback_uri,NULL,NULL,content_type,content_length,content_hash,metadata,created_at) SELECT id,track_id,playback_uri,content_type,content_length,content_hash,metadata,created_at");
  if (results.has("text")) await rebuild("search_results",
    "id TEXT PRIMARY KEY,run_id TEXT NOT NULL,url TEXT NOT NULL,status INTEGER,content_type TEXT,created_at TEXT,FOREIGN KEY(run_id) REFERENCES search_runs(id) ON DELETE CASCADE",
    "(id,run_id,url,status,content_type,created_at) SELECT id,run_id,url,status,content_type,created_at");
  if (runs.has("fragments")) await rebuild("search_runs",
    "id TEXT PRIMARY KEY,query TEXT NOT NULL,mode TEXT,started_at TEXT,finished_at TEXT,status TEXT,sources TEXT,results TEXT",
    "(id,query,mode,started_at,finished_at,status,sources,results) SELECT id,query,mode,started_at,finished_at,status,sources,results");

  await exec(`
    CREATE INDEX IF NOT EXISTS idx_production_timelines_scene ON production_timelines(scene_label);
    CREATE INDEX IF NOT EXISTS idx_production_timelines_timecode ON production_timelines(timecode);
    CREATE INDEX IF NOT EXISTS idx_production_timelines_node ON production_timelines(node_id);
    CREATE INDEX IF NOT EXISTS idx_timeline_mutations_parent ON timeline_mutations(parent_node_id);
    CREATE INDEX IF NOT EXISTS idx_timeline_mutations_branch ON timeline_mutations(branch_id);
    CREATE INDEX IF NOT EXISTS idx_search_results_run ON search_results(run_id);
    CREATE INDEX IF NOT EXISTS idx_narrative_blocks_track_position ON narrative_blocks(track_id,position);
    CREATE INDEX IF NOT EXISTS idx_timeline_mutation_visual_mutation_position ON timeline_mutation_visual(mutation_id,position);
    CREATE INDEX IF NOT EXISTS idx_timeline_mutation_vocal_mutation_position ON timeline_mutation_vocal(mutation_id,position);
    CREATE INDEX IF NOT EXISTS idx_production_timeline_audio_tags_timeline_position ON production_timeline_audio_tags(timeline_id,position);
  `);
}

async function init() {
  db = await new Promise((resolve,reject)=>{
    const x=new sqlite3.Database(file, sqlite3.OPEN_READWRITE|sqlite3.OPEN_CREATE, e=>e?reject(e):resolve(x));
  });
  db.configure("busyTimeout", busyTimeout);
  await exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA temp_store=MEMORY;");
  await migrate();
  prepared.set("search_results_by_run", db.prepare("SELECT id,url,status,content_type,created_at FROM search_results WHERE run_id=? ORDER BY rowid DESC LIMIT ?"));
  prepared.set("narrative_blocks_by_track", db.prepare("SELECT * FROM narrative_blocks WHERE track_id=? ORDER BY position"));
  prepared.set("mutation_visual_by_parent", db.prepare("SELECT value FROM timeline_mutation_visual WHERE mutation_id=? ORDER BY position"));
  prepared.set("mutation_vocal_by_parent", db.prepare("SELECT value FROM timeline_mutation_vocal WHERE mutation_id=? ORDER BY position"));
  prepared.set("timeline_audio_tags", db.prepare("SELECT tag FROM production_timeline_audio_tags WHERE timeline_id=? ORDER BY position"));
  parentPort.postMessage({id:0,ok:true,value:{ready:true,file,busyTimeout}});
}


async function fragmentText(text) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  const out = [];
  for (let offset = 0, index = 0; offset < normalized.length; offset += 4000, index++) {
    out.push({ index, offset, text: normalized.slice(offset, offset + 4000) });
  }
  return out;
}
async function appendRecord(table, record) {
  if (table === "search_runs") {
    await run("INSERT INTO search_runs(id,query,mode,started_at,finished_at,status,sources,results) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET query=excluded.query,mode=excluded.mode,started_at=excluded.started_at,finished_at=excluded.finished_at,status=excluded.status,sources=excluded.sources,results=excluded.results",
      [record.id,record.query,record.mode,record.startedAt,record.finishedAt,record.status,json(record.sources,[]),json(record.results,[])]);
    if (Array.isArray(record.fragments)) {
      await run("DELETE FROM search_run_fragments WHERE run_id=?",[record.id]);
      for (const [position,value] of record.fragments.entries())
        await run("INSERT INTO search_run_fragments(run_id,fragment_index,text) VALUES(?,?,?)",[record.id,position,String(value)]);
    }
    return record;
  }
  if (table === "search_results") {
    await run("INSERT OR REPLACE INTO search_results(id,run_id,url,status,content_type,created_at) VALUES(?,?,?,?,?,?)",
      [record.id,record.runId,record.url,record.status,record.contentType,record.createdAt]);
    if (record.text) {
      await run("DELETE FROM parsed_passage_fragments WHERE result_id=?",[record.id]);
      for (const part of await fragmentText(record.text))
        await run("INSERT INTO parsed_passage_fragments(run_id,result_id,fragment_index,char_offset,text) VALUES(?,?,?,?,?)",[record.runId,record.id,part.index,part.offset,part.text]);
    }
    return record;
  }
  if (table === "narrative_tracks") {
    await run("INSERT OR REPLACE INTO narrative_tracks(id,project_id,branch_id,timeline_id,created_at) VALUES(?,?,?,?,?)",
      [record.id,record.projectId,record.branchId,record.timelineId,record.createdAt]);
    await run("DELETE FROM narrative_blocks WHERE track_id=?",[record.id]);
    for (const [position,b] of (record.blocks??[]).entries()) {
      const block=b??{};
      await run("INSERT INTO narrative_blocks(track_id,position,block_type,text_ref,visual_ref,vocal_ref) VALUES(?,?,?,?,?,?)",
        [record.id,position,block.type??null,json(block.text,null),json(block.visualFrames??block.visual??null,null),json(block.vocal??null,null)]);
    }
    return record;
  }
  if (table === "voice_assets") {
    await run("INSERT OR REPLACE INTO voice_assets(id,track_id,playback_uri,media_uri,asset_id,content_type,content_length,content_hash,metadata,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      [record.id,record.trackId,record.playbackUri??record.mediaUri??null,record.mediaUri??null,record.assetId??null,record.contentType??null,record.contentLength??null,record.contentHash??null,json(record.metadata,{}),record.createdAt]);
    return record;
  }
  throw new Error("Unsupported OMNI table: "+table);
}
async function listRecord(table, limit) {
  const n=Math.max(1,Math.min(5000,Number(limit)||500));
  if(table==="search_runs"){
    const rows=await all("SELECT * FROM search_runs ORDER BY rowid DESC LIMIT ?",[n]);
    return Promise.all(rows.map(async row=>{
      const fragments=await all("SELECT text FROM search_run_fragments WHERE run_id=? ORDER BY fragment_index",[row.id]);
      return {...row,fragments:fragments.map(x=>x.text),sources:parse(row.sources,[]),results:parse(row.results,[])};
    }));
  }
  if(table==="search_results") return all("SELECT * FROM search_results ORDER BY rowid DESC LIMIT ?",[n]);
  if(table==="narrative_tracks"){
    const rows=await all("SELECT * FROM narrative_tracks ORDER BY rowid DESC LIMIT ?",[n]);
    return Promise.all(rows.map(async row=>{
      const blocks=await all("SELECT block_type,text_ref,visual_ref,vocal_ref FROM narrative_blocks WHERE track_id=? ORDER BY position",[row.id]);
      return {...row,blocks:blocks.map(b=>({type:b.block_type,text:parse(b.text_ref,null),visualFrames:parse(b.visual_ref,null),vocal:parse(b.vocal_ref,null)}))};
    }));
  }
  if(table==="voice_assets"){
    const rows=await all("SELECT * FROM voice_assets ORDER BY rowid DESC LIMIT ?",[n]);
    return rows.map(row=>({...row,metadata:parse(row.metadata,{})}));
  }
  throw new Error("Unsupported OMNI table: "+table);
}
async function createProductionTimeline(input={}) {
  const nodeId=String(input.nodeId??input.node_id??""); const sceneLabel=String(input.sceneLabel??input.scene_label??""); const timecode=String(input.timecode??"");
  if(!nodeId||!sceneLabel||!timecode) throw new Error("nodeId, sceneLabel, and timecode are required");
  await run("INSERT INTO production_timelines(node_id,scene_label,timecode,aesthetic_profile,prompt) VALUES(?,?,?,?,?)",[nodeId,sceneLabel,timecode,input.aestheticProfile??input.aesthetic_profile??null,input.prompt??null]);
  await run("DELETE FROM production_timeline_audio_tags WHERE timeline_id=?",[nodeId]);
  for(const [position,tag] of (Array.isArray(input.audioTags)?input.audioTags:[]).entries()) await run("INSERT INTO production_timeline_audio_tags(timeline_id,tag,position) VALUES(?,?,?)",[nodeId,String(tag),position]);
  return getProductionTimeline(nodeId);
}
async function getProductionTimeline(nodeId) {
  const row=await get("SELECT * FROM production_timelines WHERE node_id=?",[String(nodeId)]); if(!row)return null;
  const tags=await all("SELECT tag FROM production_timeline_audio_tags WHERE timeline_id=? ORDER BY position",[row.node_id]);
  return {...row,nodeId:row.node_id,sceneLabel:row.scene_label,timecode:row.timecode,aestheticProfile:row.aesthetic_profile,audioTags:tags.map(x=>x.tag)};
}
async function createTimelineMutation(input={}) {
  const parentNodeId=String(input.parentNodeId??input.parent_node_id??""); const branchId=String(input.branchId??input.branch_id??"");
  if(!parentNodeId||!branchId) throw new Error("parentNodeId and branchId are required");
  const result=await run("INSERT INTO timeline_mutations(parent_node_id,branch_id) VALUES(?,?)",[parentNodeId,branchId]);
  const id=result.lastID;
  for(const [position,value] of (Array.isArray(input.alteredVisual)?input.alteredVisual:input.visual??[]).entries()) await run("INSERT INTO timeline_mutation_visual(mutation_id,position,value) VALUES(?,?,?)",[id,position,json(value,null)]);
  for(const [position,value] of (Array.isArray(input.alteredVocal)?input.alteredVocal:input.vocal??[]).entries()) await run("INSERT INTO timeline_mutation_vocal(mutation_id,position,value) VALUES(?,?,?)",[id,position,json(value,null)]);
  return getTimelineMutation(id);
}
async function getTimelineMutation(id) {
  const row=await get("SELECT * FROM timeline_mutations WHERE id=?",[Number(id)]); if(!row)return null;
  const visual=await all("SELECT value FROM timeline_mutation_visual WHERE mutation_id=? ORDER BY position",[row.id]);
  const vocal=await all("SELECT value FROM timeline_mutation_vocal WHERE mutation_id=? ORDER BY position",[row.id]);
  return {...row,alteredVisual:visual.map(x=>parse(x.value,null)),alteredVocal:vocal.map(x=>parse(x.value,null))};
}
async function listTimelineMutations(parentNodeId=null,limit=500) {
  const n=Math.max(1,Math.min(5000,Number(limit)||500));
  const rows=parentNodeId?await all("SELECT * FROM timeline_mutations WHERE parent_node_id=? ORDER BY id ASC LIMIT ?",[String(parentNodeId),n]):await all("SELECT * FROM timeline_mutations ORDER BY id ASC LIMIT ?",[n]);
  return Promise.all(rows.map(x=>getTimelineMutation(x.id)));
}

async function op(message) {
  const { op, payload={} } = message;
  if (op==="append") return appendRecord(payload.table,payload.record);
  if (op==="list") return listRecord(payload.table,payload.limit);
  if (op==="createProductionTimeline") return createProductionTimeline(payload.input);
  if (op==="getProductionTimeline") return getProductionTimeline(payload.nodeId);
  if (op==="listProductionTimelines") {
    const rows=await all("SELECT node_id FROM production_timelines ORDER BY id ASC LIMIT ?",[Math.max(1,Math.min(5000,Number(payload.limit)||500))]);
    return Promise.all(rows.map(x=>getProductionTimeline(x.node_id)));
  }
  if (op==="createTimelineMutation") return createTimelineMutation(payload.input);
  if (op==="getTimelineMutation") return getTimelineMutation(payload.id);
  if (op==="listTimelineMutations") return listTimelineMutations(payload.parentNodeId??null,payload.limit??500);
  if (op==="searchPassages") {
    const q=String(payload.query??"").trim(); if(!q)return [];
    const n=Math.max(1,Math.min(500,Number(payload.limit)||50));
    return all(`SELECT p.id,p.run_id,p.result_id,p.fragment_index,p.char_offset,p.text,r.url,r.content_type,bm25(parsed_passage_fragments_fts) AS rank
      FROM parsed_passage_fragments_fts f JOIN parsed_passage_fragments p ON p.id=f.rowid
      LEFT JOIN search_results r ON r.id=p.result_id
      WHERE parsed_passage_fragments_fts MATCH ? ORDER BY rank LIMIT ?`,[q,n]);
  }
  if (op==="migrateLegacyText") {
    const n=Math.max(1,Math.min(10000,Number(payload.limit)||1000));
    const rows=await all("SELECT id,run_id FROM search_results ORDER BY rowid ASC LIMIT ?",[n]);
    return {migrated:rows.length};
  }
  if (op==="run") return run(payload.sql,payload.params??[]);
  if (op==="get") return get(payload.sql,payload.params??[]);
  if (op==="all") return all(payload.sql,payload.params??[]);
  if (op==="exec") return exec(payload.sql);
  if (op==="prepared") {
    const stmt=prepared.get(payload.name); if(!stmt) throw new Error("Unknown prepared statement: "+payload.name);
    return new Promise((resolve,reject)=>{
      const cb=(error,rows)=>error?reject(error):resolve(rows??[]);
      stmt.all(payload.params??[],cb);
    });
  }
  if (op==="close") {
    for (const stmt of prepared.values()) stmt.finalize();
    prepared.clear();
    await closeDb();
    return {closed:true};
  }
  throw new Error("Unknown DB worker op: "+op);
}

parentPort.on("message", async message=>{
  try { const value=await op(message); parentPort.postMessage({id:message.id,ok:true,value}); }
  catch(error){ parentPort.postMessage({id:message.id,ok:false,error:String(error?.message??error)}); }
});

init().catch(error=>parentPort.postMessage({id:0,ok:false,error:String(error?.message??error)}));
