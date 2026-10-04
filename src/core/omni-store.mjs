import crypto from "node:crypto";
import { pool } from "../db/index.js";

const asJson=value=>value==null?null:JSON.stringify(value);
const parseJson=(value,fallback=null)=>{if(value==null)return fallback;try{return typeof value==="string"?JSON.parse(value):value}catch{return fallback}};

export class OmniStore {
  constructor(){this.ready=null}
  async init(){
    if(this.ready)return this.ready;
    this.ready=(async()=>{
      await pool.query(`
        CREATE TABLE IF NOT EXISTS production_timelines(
          id BIGSERIAL PRIMARY KEY,node_id TEXT NOT NULL UNIQUE,scene_label TEXT NOT NULL,timecode TEXT NOT NULL,
          aesthetic_profile JSONB,prompt TEXT,audio_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_production_timelines_scene ON production_timelines(scene_label);
        CREATE INDEX IF NOT EXISTS idx_production_timelines_timecode ON production_timelines(timecode);
        CREATE TABLE IF NOT EXISTS timeline_mutations(
          id BIGSERIAL PRIMARY KEY,parent_node_id TEXT NOT NULL REFERENCES production_timelines(node_id) ON DELETE CASCADE,
          branch_id TEXT NOT NULL,altered_visual JSONB NOT NULL DEFAULT '[]'::jsonb,
          altered_vocal JSONB NOT NULL DEFAULT '[]'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_timeline_mutations_parent ON timeline_mutations(parent_node_id);
        CREATE INDEX IF NOT EXISTS idx_timeline_mutations_branch ON timeline_mutations(branch_id);
        CREATE TABLE IF NOT EXISTS search_runs(
          id TEXT PRIMARY KEY,query TEXT NOT NULL,mode TEXT,started_at TIMESTAMPTZ,finished_at TIMESTAMPTZ,
          status TEXT,fragments JSONB,sources JSONB,results JSONB
        );
        CREATE TABLE IF NOT EXISTS search_results(
          id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES search_runs(id) ON DELETE CASCADE,url TEXT NOT NULL,
          status INTEGER,content_type TEXT,text TEXT,created_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS idx_search_results_run ON search_results(run_id);
        CREATE TABLE IF NOT EXISTS narrative_tracks(
          id TEXT PRIMARY KEY,project_id TEXT,branch_id TEXT,timeline_id TEXT,blocks JSONB NOT NULL DEFAULT '[]'::jsonb,created_at TIMESTAMPTZ
        );
        CREATE TABLE IF NOT EXISTS voice_assets(
          id TEXT PRIMARY KEY,track_id TEXT,filepath TEXT,metadata JSONB,created_at TIMESTAMPTZ
        );
      `);
    })();
    return this.ready;
  }
  async close(){}
  async append(table,record){
    await this.init();
    if(table==="search_runs"){await pool.query(`INSERT INTO search_runs(id,query,mode,started_at,finished_at,status,fragments,sources,results) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb) ON CONFLICT(id) DO UPDATE SET query=EXCLUDED.query,mode=EXCLUDED.mode,started_at=EXCLUDED.started_at,finished_at=EXCLUDED.finished_at,status=EXCLUDED.status,fragments=EXCLUDED.fragments,sources=EXCLUDED.sources,results=EXCLUDED.results`,[record.id,record.query,record.mode,record.startedAt,record.finishedAt,record.status,asJson(record.fragments||[]),asJson(record.sources||[]),asJson(record.results||[])]);return record}
    if(table==="search_results"){await pool.query(`INSERT INTO search_results(id,run_id,url,status,content_type,text,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET url=EXCLUDED.url,status=EXCLUDED.status,content_type=EXCLUDED.content_type,text=EXCLUDED.text,created_at=EXCLUDED.created_at`,[record.id,record.runId,record.url,record.status,record.contentType,record.text,record.createdAt]);return record}
    if(table==="narrative_tracks"){await pool.query(`INSERT INTO narrative_tracks(id,project_id,branch_id,timeline_id,blocks,created_at) VALUES($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT(id) DO UPDATE SET project_id=EXCLUDED.project_id,branch_id=EXCLUDED.branch_id,timeline_id=EXCLUDED.timeline_id,blocks=EXCLUDED.blocks`,[record.id,record.projectId,record.branchId,record.timelineId,asJson(record.blocks||[]),record.createdAt]);return record}
    if(table==="voice_assets"){await pool.query(`INSERT INTO voice_assets(id,track_id,filepath,metadata,created_at) VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT(id) DO UPDATE SET track_id=EXCLUDED.track_id,filepath=EXCLUDED.filepath,metadata=EXCLUDED.metadata`,[record.id,record.trackId,record.filepath,asJson(record.metadata||{}),record.createdAt]);return record}
    throw new Error("Unsupported OMNI table: "+table);
  }
  async list(table,limit=500){
    await this.init();const n=Math.max(1,Math.min(5000,Number(limit)||500));
    const q={search_runs:"SELECT * FROM search_runs ORDER BY started_at DESC NULLS LAST LIMIT $1",search_results:"SELECT * FROM search_results ORDER BY created_at DESC NULLS LAST LIMIT $1",narrative_tracks:"SELECT * FROM narrative_tracks ORDER BY created_at DESC NULLS LAST LIMIT $1",voice_assets:"SELECT * FROM voice_assets ORDER BY created_at DESC NULLS LAST LIMIT $1"}[table];
    if(!q)throw new Error("Unsupported OMNI table: "+table);
    const rows=(await pool.query(q,[n])).rows;
    return rows.map(r=>({...r,fragments:parseJson(r.fragments,[]),sources:parseJson(r.sources,[]),results:parseJson(r.results,[]),blocks:parseJson(r.blocks,[]),metadata:parseJson(r.metadata,{})}));
  }
  async createProductionTimeline(input={}){
    const record={nodeId:String(input.nodeId??input.node_id??""),sceneLabel:String(input.sceneLabel??input.scene_label??""),timecode:String(input.timecode??""),aestheticProfile:input.aestheticProfile??input.aesthetic_profile??null,prompt:input.prompt??null,audioTags:Array.isArray(input.audioTags)?input.audioTags:[]};
    if(!record.nodeId||!record.sceneLabel||!record.timecode)throw new Error("nodeId, sceneLabel, and timecode are required");
    await this.init();
    await pool.query(`INSERT INTO production_timelines(node_id,scene_label,timecode,aesthetic_profile,prompt,audio_tags) VALUES($1,$2,$3,$4::jsonb,$5,$6::jsonb) ON CONFLICT(node_id) DO UPDATE SET scene_label=EXCLUDED.scene_label,timecode=EXCLUDED.timecode,aesthetic_profile=EXCLUDED.aesthetic_profile,prompt=EXCLUDED.prompt,audio_tags=EXCLUDED.audio_tags,updated_at=NOW()`,[record.nodeId,record.sceneLabel,record.timecode,asJson(record.aestheticProfile),record.prompt,asJson(record.audioTags)]);
    return this.getProductionTimeline(record.nodeId);
  }
  async listProductionTimelines(limit=500){await this.init();const n=Math.max(1,Math.min(5000,Number(limit)||500));const rows=(await pool.query("SELECT * FROM production_timelines ORDER BY id ASC LIMIT $1",[n])).rows;return rows.map(r=>({...r,nodeId:r.node_id,sceneLabel:r.scene_label,timecode:r.timecode,aestheticProfile:parseJson(r.aesthetic_profile,null),audioTags:parseJson(r.audio_tags,[])}))}
  async getProductionTimeline(nodeId){await this.init();const r=(await pool.query("SELECT * FROM production_timelines WHERE node_id=$1",[String(nodeId)])).rows[0];if(!r)return null;return {...r,nodeId:r.node_id,sceneLabel:r.scene_label,timecode:r.timecode,aestheticProfile:parseJson(r.aesthetic_profile,null),audioTags:parseJson(r.audio_tags,[])}}
  async createTimelineMutation(input={}){
    const parentNodeId=String(input.parentNodeId??input.parent_node_id??""),branchId=String(input.branchId??input.branch_id??"");
    if(!parentNodeId||!branchId)throw new Error("parentNodeId and branchId are required");
    const r=(await pool.query("INSERT INTO timeline_mutations(parent_node_id,branch_id,altered_visual,altered_vocal) VALUES($1,$2,$3::jsonb,$4::jsonb) RETURNING id",[parentNodeId,branchId,asJson(Array.isArray(input.alteredVisual)?input.alteredVisual:[]),asJson(Array.isArray(input.alteredVocal)?input.alteredVocal:[])])).rows[0];
    return this.getTimelineMutation(r.id);
  }
  async listTimelineMutations(parentNodeId=null,limit=500){await this.init();const n=Math.max(1,Math.min(5000,Number(limit)||500));const q=parentNodeId?"SELECT * FROM timeline_mutations WHERE parent_node_id=$1 ORDER BY id DESC LIMIT $2":"SELECT * FROM timeline_mutations ORDER BY id DESC LIMIT $1";const params=parentNodeId?[String(parentNodeId),n]:[n];const rows=(await pool.query(q,params)).rows;return rows.map(r=>({...r,parentNodeId:r.parent_node_id,branchId:r.branch_id,alteredVisual:parseJson(r.altered_visual,[]),alteredVocal:parseJson(r.altered_vocal,[])}))}
  async getTimelineMutation(id){await this.init();const r=(await pool.query("SELECT * FROM timeline_mutations WHERE id=$1",[Number(id)])).rows[0];if(!r)return null;return {...r,parentNodeId:r.parent_node_id,branchId:r.branch_id,alteredVisual:parseJson(r.altered_visual,[]),alteredVocal:parseJson(r.altered_vocal,[])}}
}
export const OMNI_SCHEMA=Object.freeze({production_timelines:["node_id","scene_label","timecode","aesthetic_profile","prompt","audio_tags"],timeline_mutations:["parent_node_id","branch_id","altered_visual","altered_vocal"],search_runs:["id","query","mode","started_at","finished_at","status"],search_results:["id","run_id","url","status","content_type","text","created_at"],narrative_tracks:["id","project_id","branch_id","timeline_id","blocks","created_at"],voice_assets:["id","track_id","filepath","metadata","created_at"]});
