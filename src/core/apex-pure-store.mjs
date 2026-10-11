import { mkdir, rename, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ApexRingWAL } from "./apex-ring-wal.mjs";

const ROOT=process.env.APEX_SE_X_ROOT||"/srv/apex/se-x";
const PROJECTS=process.env.APEX_PROJECTS_DIR||path.join(ROOT,"projects");
const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
const safe=v=>String(v).replace(/[^a-zA-Z0-9._:-]/g,"_");

export class ApexPureStore {
  constructor({root=PROJECTS,wal=new ApexRingWAL()}={}){this.root=root;this.wal=wal;this.state=new Map();this.jobsState=new Map();this.ready=false;}
  async init(){
    if(this.ready)return this;
    await mkdir(this.root,{recursive:true});await this.wal.init();
    await this.wal.replay({onRecord:r=>this.apply(r)});
    this.ready=true;return this;
  }
  key(c,id){return String(c)+"::"+String(id);}
  apply(r){
    const p=r.payload||{};
    if(r.type==="state.put"){this.state.set(this.key(p.collection,p.id),clone(p.record));}
    if(r.type==="state.delete"){this.state.delete(this.key(p.collection,p.id));}
    if(r.type==="job.enqueue"){this.jobsState.set(String(p.id),clone(p.job));}
    if(r.type==="job.transition"){const j=this.jobsState.get(String(p.id));if(j)this.jobsState.set(String(p.id),{...j,...clone(p.patch)});}
  }
  file(c,id){return path.join(this.root,safe(c),safe(id)+".json");}
  async atomic(file,value){
    await mkdir(path.dirname(file),{recursive:true});
    const tmp=file+"."+process.pid+"."+randomUUID()+".tmp";
    await writeFile(tmp,JSON.stringify(value,null,2)+"\n","utf8");await rename(tmp,file);
  }
  async put(collection,id,record){
    await this.init();const value={...clone(record),id:String(id),updatedAt:new Date().toISOString()};
    const r=await this.wal.append("state.put",{collection,id:String(id),record:value});this.apply(r);await this.atomic(this.file(collection,id),value);return clone(value);
  }
  async create(collection,record={}){const id=String(record.id||randomUUID());return this.put(collection,id,{...record,id});}
  async get(collection,id){await this.init();const v=this.state.get(this.key(collection,id));return clone(v)||null;}
  async list(collection){await this.init();return [...this.state.entries()].filter(([k])=>k.startsWith(String(collection)+"::")).map(([,v])=>clone(v));}
  async query(collection,predicate=()=>true,{sort,limit=10000}={}){let rows=(await this.list(collection)).filter(predicate);if(sort)rows.sort(sort);return rows.slice(0,Math.max(1,Number(limit)||10000));}
  async delete(collection,id){await this.init();const r=await this.wal.append("state.delete",{collection,id:String(id)});this.apply(r);return true;}

  async enqueue({id=randomUUID(),type,payload={},runAt=Date.now(),maxAttempts=5,dedupeKey=null}){
    await this.init();if(!type)throw new Error("job type required");
    if(dedupeKey){const existing=[...this.jobsState.values()].find(j=>j.dedupeKey===String(dedupeKey)&&["queued","running"].includes(j.status));if(existing)return {durable:true,id:existing.id,duplicate:true};}
    const job={id:String(id),type:String(type),payload:clone(payload),status:"queued",attempts:0,maxAttempts:Math.max(1,Number(maxAttempts)||5),dedupeKey:dedupeKey?String(dedupeKey):null,runAt:Number(runAt)||Date.now(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),leaseOwner:null,leaseToken:null,leaseFence:0,leaseExpiresAt:0,recoveredCount:0};
    const r=await this.wal.append("job.enqueue",{id:job.id,job});this.apply(r);return {durable:true,id:job.id};
  }
  jobs(){return [...this.jobsState.values()].map(clone);}
  async claim({workerId="local",limit=1,leaseMs=45000,role=null}={}){
    await this.init();const now=Date.now(),out=[];const candidates=[...this.jobsState.values()].filter(j=>j.status==="queued"&&j.attempts<j.maxAttempts&&j.runAt<=now&&(!role||j.payload?._apex_worker?.role===role)).sort((a,b)=>(b.priority||0)-(a.priority||0)||a.runAt-b.runAt);
    for(const j of candidates.slice(0,Math.max(1,Number(limit)||1))){const token=randomUUID(),fence=Number(j.leaseFence||0)+1;const patch={status:"running",attempts:Number(j.attempts)+1,leaseOwner:String(workerId),leaseToken:token,leaseFence:fence,leaseExpiresAt:now+leaseMs,updatedAt:new Date().toISOString()};const r=await this.wal.append("job.transition",{id:j.id,patch});this.apply(r);out.push({...j,...patch});}
    return out;
  }
  async transition(id,op,{leaseToken,leaseFence,leaseMs=45000,result=null,error=null,delayMs=1000,reason=""}={}){
    await this.init();const j=this.jobsState.get(String(id));if(!j||j.status!=="running"||j.leaseToken!==leaseToken||(leaseFence!=null&&Number(j.leaseFence)!==Number(leaseFence)))return false;
    let patch={updatedAt:new Date().toISOString()};
    if(op==="heartbeat")patch={...patch,leaseExpiresAt:Date.now()+leaseMs};
    if(op==="complete")patch={...patch,status:"completed",result:clone(result),leaseOwner:null,leaseToken:null,leaseExpiresAt:0,completedAt:new Date().toISOString()};
    if(op==="defer")patch={...patch,status:"queued",runAt:Date.now()+Math.max(1,Number(delayMs)||1),lastError:String(reason).slice(0,4000),leaseOwner:null,leaseToken:null,leaseExpiresAt:0};
    if(op==="fail"){const attempts=Number(j.attempts);const dead=attempts>=Number(j.maxAttempts);patch={...patch,status:dead?"dead":"queued",runAt:dead?j.runAt:Date.now()+Math.min(300000,(2**attempts)*1000+Math.random()*5000),lastError:String(error?.message||error||"Worker task failed").slice(0,4000),leaseOwner:null,leaseToken:null,leaseExpiresAt:0};}
    const r=await this.wal.append("job.transition",{id:j.id,patch});this.apply(r);return true;
  }
  async recoverExpired(limit=500){await this.init();let n=0;const now=Date.now();for(const j of [...this.jobsState.values()].filter(x=>x.status==="running"&&x.leaseExpiresAt<now).slice(0,limit)){const r=await this.wal.append("job.transition",{id:j.id,patch:{status:j.attempts>=j.maxAttempts?"dead":"queued",leaseOwner:null,leaseToken:null,leaseExpiresAt:0,recoveredCount:Number(j.recoveredCount||0)+1,lastError:"Worker lease expired; task reclaimed",runAt:Date.now()+1000,updatedAt:new Date().toISOString()}});this.apply(r);n++;}return n;}
  async snapshot(){await this.init();return {root:this.root,jobs:this.jobs(),state:[...this.state.values()].map(clone),wal:await this.wal.snapshot()};}
}
export const apexPureStore=new ApexPureStore();
