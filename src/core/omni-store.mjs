import { apexPureDataStore as store } from "./apex-pure-data.mjs";

export class OmniStore {
  constructor() { this.ready = null; }
  async init() { if (!this.ready) this.ready = store.init(); await this.ready; return this; }
  async close() {}
  async append(table, record) { await this.init(); const id = String(record.id || (table + "-" + Date.now() + "-" + Math.random().toString(16).slice(2))); return store.put(table, id, record); }
  async list(table, limit=500) { await this.init(); const rows = await store.list(table); return rows.slice(-Math.max(1, Math.min(5000, Number(limit)||500))).reverse(); }
  async createProductionTimeline(input={}) {
    const nodeId=String(input.nodeId ?? input.node_id ?? ""); const sceneLabel=String(input.sceneLabel ?? input.scene_label ?? ""); const timecode=String(input.timecode ?? "");
    if(!nodeId || !sceneLabel || !timecode) throw new Error("nodeId, sceneLabel, and timecode are required");
    return store.put("production_timelines",nodeId,{nodeId,sceneLabel,timecode,aestheticProfile:input.aestheticProfile ?? input.aesthetic_profile ?? null,prompt:input.prompt ?? null,audioTags:Array.isArray(input.audioTags)?input.audioTags:[]});
  }
  async listProductionTimelines(limit=500){ return store.query("production_timelines",()=>true,{limit,sort:(a,b)=>String(a.timecode).localeCompare(String(b.timecode))}); }
  async getProductionTimeline(nodeId){ return store.get("production_timelines",String(nodeId)); }
  async createTimelineMutation(input={}) {
    const parentNodeId=String(input.parentNodeId ?? input.parent_node_id ?? ""); const branchId=String(input.branchId ?? input.branch_id ?? "");
    if(!parentNodeId || !branchId) throw new Error("parentNodeId and branchId are required");
    const id=String(input.id || (parentNodeId + ":" + branchId + ":" + Date.now()));
    return store.put("timeline_mutations",id,{id,parentNodeId,branchId,alteredVisual:Array.isArray(input.alteredVisual)?input.alteredVisual:[],alteredVocal:Array.isArray(input.alteredVocal)?input.alteredVocal:[]});
  }
  async listTimelineMutations(parentNodeId=null,limit=500){ return store.query("timeline_mutations",row=>!parentNodeId||String(row.parentNodeId)===String(parentNodeId),{limit,sort:(a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))}); }
}
export const OMNI_SCHEMA=Object.freeze({storage:"jsonl-ring-wal",root:process.env.APEX_SE_X_ROOT||"/srv/apex/se-x"});