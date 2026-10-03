import sqlite3 from "sqlite3";
import path from "node:path";

const DEFAULT_DB=process.env.APEX_OMNI_DB_FILE??"./apex-omni.sqlite";
const json=v=>JSON.stringify(v??null);
const parse=v=>{try{return v==null||v===""?null:JSON.parse(v)}catch{return null}};

export class OmniStore{
  constructor(file=DEFAULT_DB){this.file=path.resolve(file);this.db=null;this.ready=null}
  async init(){
    if(this.ready)return this.ready;
    this.ready=new Promise((resolve,reject)=>{
      this.db=new sqlite3.Database(this.file,sqlite3.OPEN_READWRITE|sqlite3.OPEN_CREATE,error=>{
        if(error)return reject(error);
        this.db.exec(`
          PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
          CREATE TABLE IF NOT EXISTS production_timelines(id INTEGER PRIMARY KEY AUTOINCREMENT,node_id TEXT NOT NULL UNIQUE,scene_label TEXT NOT NULL,timecode TEXT NOT NULL,aesthetic_profile TEXT,prompt TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
          CREATE INDEX IF NOT EXISTS idx_production_timelines_scene ON production_timelines(scene_label);
          CREATE INDEX IF NOT EXISTS idx_production_timelines_timecode ON production_timelines(timecode);
          CREATE INDEX IF NOT EXISTS idx_production_timelines_node ON production_timelines(node_id);
          CREATE TABLE IF NOT EXISTS timeline_audio_tags(node_id TEXT NOT NULL,tag_index INTEGER NOT NULL,tag TEXT NOT NULL,PRIMARY KEY(node_id,tag_index),FOREIGN KEY(node_id) REFERENCES production_timelines(node_id) ON UPDATE CASCADE ON DELETE CASCADE);
          CREATE INDEX IF NOT EXISTS idx_timeline_audio_tags_tag ON timeline_audio_tags(tag);
          CREATE TABLE IF NOT EXISTS timeline_mutations(id INTEGER PRIMARY KEY AUTOINCREMENT,parent_node_id TEXT NOT NULL,branch_id TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(parent_node_id) REFERENCES production_timelines(node_id) ON UPDATE CASCADE ON DELETE CASCADE);
          CREATE INDEX IF NOT EXISTS idx_timeline_mutations_parent ON timeline_mutations(parent_node_id);
          CREATE INDEX IF NOT EXISTS idx_timeline_mutations_branch ON timeline_mutations(branch_id);
          CREATE TABLE IF NOT EXISTS timeline_mutation_visual(mutation_id INTEGER NOT NULL,item_index INTEGER NOT NULL,item_value TEXT NOT NULL,PRIMARY KEY(mutation_id,item_index),FOREIGN KEY(mutation_id) REFERENCES timeline_mutations(id) ON DELETE CASCADE);
          CREATE TABLE IF NOT EXISTS timeline_mutation_vocal(mutation_id INTEGER NOT NULL,item_index INTEGER NOT NULL,item_value TEXT NOT NULL,PRIMARY KEY(mutation_id,item_index),FOREIGN KEY(mutation_id) REFERENCES timeline_mutations(id) ON DELETE CASCADE);
          CREATE TABLE IF NOT EXISTS search_runs(id TEXT PRIMARY KEY,query TEXT NOT NULL,mode TEXT,started_at TEXT,finished_at TEXT,status TEXT,fragments TEXT,sources TEXT,results TEXT);
          CREATE TABLE IF NOT EXISTS search_results(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,url TEXT NOT NULL,status INTEGER,content_type TEXT,created_at TEXT,FOREIGN KEY(run_id) REFERENCES search_runs(id) ON DELETE CASCADE);
          CREATE INDEX IF NOT EXISTS idx_search_results_run ON search_results(run_id);
          CREATE TABLE IF NOT EXISTS search_result_payloads(result_id TEXT PRIMARY KEY,text TEXT NOT NULL DEFAULT "",FOREIGN KEY(result_id) REFERENCES search_results(id) ON DELETE CASCADE);
          CREATE TABLE IF NOT EXISTS narrative_tracks(id TEXT PRIMARY KEY,project_id TEXT,branch_id TEXT,timeline_id TEXT,created_at TEXT);
          CREATE TABLE IF NOT EXISTS narrative_track_blocks(track_id TEXT NOT NULL,block_index INTEGER NOT NULL,block_value TEXT NOT NULL,PRIMARY KEY(track_id,block_index),FOREIGN KEY(track_id) REFERENCES narrative_tracks(id) ON DELETE CASCADE);
          CREATE TABLE IF NOT EXISTS voice_assets(id TEXT PRIMARY KEY,track_id TEXT,uri TEXT NOT NULL,metadata TEXT,created_at TEXT);
        `,error=>error?reject(error):resolve(this));
      });
    });
    return this.ready;
  }
  async close(){if(!this.db)return;await new Promise((resolve,reject)=>this.db.close(e=>e?reject(e):resolve()));this.db=null;this.ready=null}
  run(sql,p=[]){return this.init().then(()=>new Promise((resolve,reject)=>this.db.run(sql,p,function(e){e?reject(e):resolve({changes:this.changes,lastID:this.lastID})})))}
  get(sql,p=[]){return this.init().then(()=>new Promise((resolve,reject)=>this.db.get(sql,p,(e,row)=>e?reject(e):resolve(row??null))))}
  all(sql,p=[]){return this.init().then(()=>new Promise((resolve,reject)=>this.db.all(sql,p,(e,rows)=>e?reject(e):resolve(rows??[]))))}
  async transaction(fn){await this.init();await this.run("BEGIN IMMEDIATE");try{const out=await fn();await this.run("COMMIT");return out}catch(e){try{await this.run("ROLLBACK")}catch{}throw e}}
  async append(table,r){
    if(table==="search_runs"){await this.run(`INSERT INTO search_runs(id,query,mode,started_at,finished_at,status,fragments,sources,results) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET query=excluded.query,mode=excluded.mode,started_at=excluded.started_at,finished_at=excluded.finished_at,status=excluded.status,fragments=excluded.fragments,sources=excluded.sources,results=excluded.results`,[r.id,r.query,r.mode,r.startedAt,r.finishedAt,r.status,json(r.fragments??[]),json(r.sources??[]),json(r.results??[])]);return r}
    if(table==="search_results"){await this.transaction(async()=>{await this.run(`INSERT OR REPLACE INTO search_results(id,run_id,url,status,content_type,created_at) VALUES(?,?,?,?,?,?)`,[r.id,r.runId,r.url,r.status,r.contentType,r.createdAt]);await this.run(`INSERT OR REPLACE INTO search_result_payloads(result_id,text) VALUES(?,?)`,[r.id,r.text??""]) });return r}
    if(table==="narrative_tracks"){await this.transaction(async()=>{await this.run(`INSERT OR REPLACE INTO narrative_tracks(id,project_id,branch_id,timeline_id,created_at) VALUES(?,?,?,?,?)`,[r.id,r.projectId,r.branchId,r.timelineId,r.createdAt]);await this.run(`DELETE FROM narrative_track_blocks WHERE track_id=?`,[r.id]);for(let i=0;i<(r.blocks??[]).length;i++)await this.run(`INSERT INTO narrative_track_blocks(track_id,block_index,block_value) VALUES(?,?,?)`,[r.id,i,json(r.blocks[i])])});return r}
    if(table==="voice_assets"){await this.run(`INSERT OR REPLACE INTO voice_assets(id,track_id,uri,metadata,created_at) VALUES(?,?,?,?,?)`,[r.id,r.trackId,r.uri??"",json(r.metadata??{}),r.createdAt]);return r}
    throw new Error(`Unsupported OMNI table: ${table}`)
  }
  async list(table,limit=500){
    const n=Math.max(1,Math.min(5000,Number(limit)||500));
    if(table==="search_runs"){return (await this.all(`SELECT * FROM search_runs ORDER BY rowid DESC LIMIT ?`,[n])).map(r=>({...r,fragments:parse(r.fragments)??[],sources:parse(r.sources)??[],results:parse(r.results)??[]}))}
    if(table==="search_results"){return (await this.all(`SELECT r.*,p.text FROM search_results r LEFT JOIN search_result_payloads p ON p.result_id=r.id ORDER BY r.rowid DESC LIMIT ?`,[n]))}
    if(table==="narrative_tracks"){const rows=await this.all(`SELECT * FROM narrative_tracks ORDER BY rowid DESC LIMIT ?`,[n]);for(const r of rows){const b=await this.all(`SELECT block_value FROM narrative_track_blocks WHERE track_id=? ORDER BY block_index`,[r.id]);r.blocks=b.map(x=>parse(x.block_value)).filter(x=>x!=null)}return rows}
    if(table==="voice_assets"){return (await this.all(`SELECT * FROM voice_assets ORDER BY rowid DESC LIMIT ?`,[n])).map(r=>({...r,metadata:parse(r.metadata)??{}}))}
    throw new Error(`Unsupported OMNI table: ${table}`)
  }
  async createProductionTimeline(i={}){
    const r={nodeId:String(i.nodeId??i.node_id??""),sceneLabel:String(i.sceneLabel??i.scene_label??""),timecode:String(i.timecode??""),aestheticProfile:i.aestheticProfile??i.aesthetic_profile??null,prompt:i.prompt??null,audioTags:Array.isArray(i.audioTags)?i.audioTags:[]};
    if(!r.nodeId||!r.sceneLabel||!r.timecode)throw new Error("nodeId, sceneLabel, and timecode are required");
    await this.transaction(async()=>{await this.run(`INSERT INTO production_timelines(node_id,scene_label,timecode,aesthetic_profile,prompt) VALUES(?,?,?,?,?)`,[r.nodeId,r.sceneLabel,r.timecode,r.aestheticProfile,r.prompt]);for(let i=0;i<r.audioTags.length;i++)await this.run(`INSERT INTO timeline_audio_tags(node_id,tag_index,tag) VALUES(?,?,?)`,[r.nodeId,i,String(r.audioTags[i])])});
    return this.getProductionTimeline(r.nodeId)
  }
  async hydrateTimeline(row){if(!row)return null;const tags=await this.all(`SELECT tag FROM timeline_audio_tags WHERE node_id=? ORDER BY tag_index`,[row.node_id]);return {...row,nodeId:row.node_id,sceneLabel:row.scene_label,timecode:row.timecode,aestheticProfile:row.aesthetic_profile,audioTags:tags.map(x=>x.tag)}}
  async listProductionTimelines(limit=500){const n=Math.max(1,Math.min(5000,Number(limit)||500));const rows=await this.all(`SELECT * FROM production_timelines ORDER BY id ASC LIMIT ?`,[n]);return Promise.all(rows.map(r=>this.hydrateTimeline(r)))}
  async getProductionTimeline(id){return this.hydrateTimeline(await this.get(`SELECT * FROM production_timelines WHERE node_id=?`,[String(id)]))}
  async createTimelineMutation(i={}){
    const parentNodeId=String(i.parentNodeId??i.parent_node_id??""),branchId=String(i.branchId??i.branch_id??"");
    if(!parentNodeId||!branchId)throw new Error("parentNodeId and branchId are required");
    const visual=Array.isArray(i.alteredVisual)?i.alteredVisual:[],vocal=Array.isArray(i.alteredVocal)?i.alteredVocal:[];
    const out=await this.transaction(async()=>{const x=await this.run(`INSERT INTO timeline_mutations(parent_node_id,branch_id) VALUES(?,?)`,[parentNodeId,branchId]);for(let n=0;n<visual.length;n++)await this.run(`INSERT INTO timeline_mutation_visual(mutation_id,item_index,item_value) VALUES(?,?,?)`,[x.lastID,n,json(visual[n])]);for(let n=0;n<vocal.length;n++)await this.run(`INSERT INTO timeline_mutation_vocal(mutation_id,item_index,item_value) VALUES(?,?,?)`,[x.lastID,n,json(vocal[n])]);return x.lastID});return this.getTimelineMutation(out)}
  async hydrateMutation(row){if(!row)return null;const [visual,vocal]=await Promise.all([this.all(`SELECT item_value FROM timeline_mutation_visual WHERE mutation_id=? ORDER BY item_index`,[row.id]),this.all(`SELECT item_value FROM timeline_mutation_vocal WHERE mutation_id=? ORDER BY item_index`,[row.id])]);return {...row,parentNodeId:row.parent_node_id,branchId:row.branch_id,alteredVisual:visual.map(x=>parse(x.item_value)).filter(x=>x!=null),alteredVocal:vocal.map(x=>parse(x.item_value)).filter(x=>x!=null)}}
  async listTimelineMutations(parentNodeId=null,limit=500){const n=Math.max(1,Math.min(5000,Number(limit)||500));const rows=parentNodeId?await this.all(`SELECT * FROM timeline_mutations WHERE parent_node_id=? ORDER BY id DESC LIMIT ?`,[String(parentNodeId),n]):await this.all(`SELECT * FROM timeline_mutations ORDER BY id DESC LIMIT ?`,[n]);return Promise.all(rows.map(r=>this.hydrateMutation(r)))}
  async getTimelineMutation(id){return this.hydrateMutation(await this.get(`SELECT * FROM timeline_mutations WHERE id=?`,[Number(id)]))}
}

export const OMNI_SCHEMA=Object.freeze({
  production_timelines:["node_id","scene_label","timecode","aesthetic_profile","prompt"],
  timeline_audio_tags:["node_id","tag_index","tag"],
  timeline_mutations:["id","parent_node_id","branch_id"],
  timeline_mutation_visual:["mutation_id","item_index","item_value"],
  timeline_mutation_vocal:["mutation_id","item_index","item_value"],
  search_runs:["id","query","mode","started_at","finished_at","status"],
  search_results:["id","run_id","url","status","content_type","created_at"],
  search_result_payloads:["result_id","text"],
  narrative_tracks:["id","project_id","branch_id","timeline_id","created_at"],
  narrative_track_blocks:["track_id","block_index","block_value"],
  voice_assets:["id","track_id","uri","metadata","created_at"]
});