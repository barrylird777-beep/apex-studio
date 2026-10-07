import crypto from "node:crypto";
import { apexPureStore } from "./apex-pure-store.mjs";

export class OmniStore {
  constructor(){this.store=apexPureStore;}
  async init(){await this.store.init();return this;}
  async close(){}
  async append(table,record){return this.store.put("omni:"+String(table),record.id||crypto.randomUUID(),record);}
  async list(table,limit=500){return (await this.store.list("omni:"+String(table))).slice(0,Math.max(1,Number(limit)||500));}
  async createProductionTimeline(input={}){
    const record={id:String(input.nodeId??input.node_id??crypto.randomUUID()),nodeId:String(input.nodeId??input.node_id??""),sceneLabel:String(input.sceneLabel??input.scene_label??""),timecode:String(input.timecode??""),aestheticProfile:input.aestheticProfile??input.aesthetic_profile??null,prompt:input.prompt??null,audioTags:Array.isArray(input.audioTags)?input.audioTags:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    if(!record.nodeId||!record.sceneLabel||!record.timecode)throw new Error("nodeId, sceneLabel, and timecode are required");
    return this.append("production_timelines",record);
  }
  async createTimelineMutation(input={}){
    const record={id:crypto.randomUUID(),parentNodeId:String(input.parentNodeId??input.parent_node_id??""),branchId:String(input.branchId??input.branch_id??""),alteredVisual:Array.isArray(input.alteredVisual)?input.alteredVisual:[],alteredVocal:Array.isArray(input.alteredVocal)?input.alteredVocal:[],createdAt:new Date().toISOString()};
    if(!record.parentNodeId||!record.branchId)throw new Error("parentNodeId and branchId are required");
    return this.append("timeline_mutations",record);
  }
}
export default OmniStore;
