import { mkdir, rename, writeFile, readFile, realpath, lstat, open } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ApexRingWAL } from "./apex-ring-wal.mjs";

const ROOT=process.env.APEX_SE_X_ROOT||"/srv/apex/se-x";
const PROJECTS=process.env.APEX_PROJECTS_DIR||path.join(ROOT,"projects");
const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
const SEGMENT=/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

function safeSegment(value,label){
  const segment=String(value);
  if(!SEGMENT.test(segment)||segment==="."||segment===".."||segment.includes("..")){
    throw new Error(`[SECURITY_VIOLATION] Invalid ${label} path segment.`);
  }
  return segment;
}
function inside(root,target){
  const rel=path.relative(root,target);
  return rel!==""&&!rel.startsWith(`..${path.sep}`)&&rel!==".."&&!path.isAbsolute(rel);
}
async function syncDirectory(dir){
  const handle=await open(dir,"r");
  try{await handle.sync();}finally{await handle.close();}
}

export class ApexPureStore {
  constructor({root=PROJECTS,wal=new ApexRingWAL()}={}){this.root=path.resolve(root);this.wal=wal;this.state=new Map();this.jobsState=new Map();this.ready=false;this.mutationChain=Promise.resolve();}
  async init(){
    if(this.ready)return this;
    await mkdir(this.root,{recursive:true,mode:0o700});
    await this.wal.init();
    await this.wal.replay({onRecord:r=>this.apply(r)});
    this.ready=true;return this;
  }
  async refresh(){
    await this.init();
    this.state.clear();this.jobsState.clear();
    await this.wal.replay({onRecord:r=>this.apply(r)});
    return this;
  }
  key(c,id){return String(c)+"::"+String(id);}
  apply(r){
    const p=r.payload||{};
    if(r.type==="state.put"){this.state.set(this.key(p.collection,p.id),clone(p.record));}
    if(r.type==="state.delete"){this.state.delete(this.key(p.collection,p.id));}
    if(r.type==="job.enqueue"){this.jobsState.set(String(p.id),clone(p.job));}
    if(r.type==="job.transition"){const j=this.jobsState.get(String(p.id));if(j)this.jobsState.set(String(p.id),{...j,...clone(p.patch)});}
  }
  async checkedFile(collection,id,{createDir=false}={}){
    const c=safeSegment(collection,"collection"),i=safeSegment(id,"record id");
    if(createDir)await mkdir(this.root,{recursive:true,mode:0o700});
    const root=await realpath(this.root);
    const dir=path.join(root,c);
    if(createDir)await mkdir(dir,{recursive:false,mode:0o700}).catch(e=>{if(e.code!=="EEXIST")throw e;});
    let dirInfo;
    try{dirInfo=await lstat(dir);}catch(e){if(e.code==="ENOENT"&&!createDir)return path.join(dir,i+".json");throw e;}
    if(dirInfo.isSymbolicLink()||!dirInfo.isDirectory())throw new Error("[SECURITY_VIOLATION] Storage collection must be a real directory.");
    const realDir=await realpath(dir);
    if(!inside(root,realDir))throw new Error("[SECURITY_VIOLATION] Storage path escapes the configured root.");
    const file=path.join(realDir,i+".json");
    try{const info=await lstat(file);if(info.isSymbolicLink()||!info.isFile())throw new Error("[SECURITY_VIOLATION] Storage target must be a regular file.");}
    catch(e){if(e.code!=="ENOENT")throw e;}
    if(!inside(root,file))throw new Error("[SECURITY_VIOLATION] Storage target escapes the configured root.");
    return file;
  }
  async file(c,id){return this.checkedFile(c,id);}
  async atomic(file,value){
    const parent=path.dirname(file);
    const temp=file+"."+process.pid+"."+randomUUID()+".tmp";
    const fh=await open(temp,"wx",0o600);
    try{await fh.writeFile(JSON.stringify(value,null,2)+"\n","utf8");await fh.sync();}
    catch(e){await fh.close().catch(()=>{});throw e;}
    await fh.close();
    try{await rename(temp,file);await syncDirectory(parent);}
    catch(e){throw e;}
  }
  async put(collection,id,record){
    await this.refresh();
    const target=await this.checkedFile(collection,id,{createDir:true});
    const value={...clone(record),id:String(id),updatedAt:new Date().toISOString()};
    const r=await this.wal.append("state.put",{collection:String(collection),id:String(id),record:value});
    this.apply(r);await this.atomic(target,value);return clone(value);
  }
  async create(collection,record={}){const id=String(record.id||randomUUID());return this.put(collection,id,{...record,id});}
  async get(collection,id){await this.refresh();const v=this.state.get(this.key(collection,id));return clone(v)||null;}
  async list(collection){await this.refresh();return [...this.state.entries()].filter(([k])=>k.startsWith(String(collection)+"::")).map(([,v])=>clone(v));}
  async query(collection,predicate=()=>true,{sort,limit=10000}={}){let rows=(await this.list(collection)).filter(predicate);if(sort)rows.sort(sort);return rows.slice(0,Math.max(1,Number(limit)||10000));}
  async delete(collection,id){
    await this.init();
    const target=await this.checkedFile(collection,id);
    const r=await this.wal.append("state.delete",{collection:String(collection),id:String(id)});
    this.apply(r);
    // The WAL is authoritative. Removing a projection is best-effort only after
    // its path has passed the same containment and symlink checks.
    const { unlink }=await import("node:fs/promises");
    try{await unlink(target);await syncDirectory(path.dirname(target));}catch(e){if(e.code!=="ENOENT")throw e;}
    return true;
  }
  async enqueue({id=randomUUID(),type,payload={},runAt=Date.now(),maxAttempts=5,dedupeKey=null}={}){
    await this.refresh();if(!type)throw new Error("job type required");
    if(dedupeKey){const existing=[...this.jobsState.values()].find(j=>j.dedupeKey===String(dedupeKey)&&["queued","running"].includes(j.status));if(existing)return {durable:true,id:existing.id,duplicate:true};}
    const job={id:String(id),type:String(type),payload:clone(payload),status:"queued",attempts:0,maxAttempts:Math.max(1,Number(maxAttempts)||5),dedupeKey:dedupeKey?String(dedupeKey):null,runAt:Number(runAt)||Date.now(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),leaseOwner:null,leaseToken:null,leaseFence:0,leaseExpiresAt:0,recoveredCount:0};
    const r=await this.wal.append("job.enqueue",{id:job.id,job});this.apply(r);return {durable:true,id:job.id};
  }
  jobs(){return [...this.jobsState.values()].map(clone);}
  async claim({workerId="local",limit=1,leaseMs=45000,role=null}={}){
    await this.refresh();
    const run=async()=>{
      const now=Date.now(),out=[];
      const candidates=[...this.jobsState.values()].filter(j=>j.status==="queued"&&j.attempts<j.maxAttempts&&j.runAt<=now&&(!role||j.payload?._apex_worker?.role===role)).sort((a,b)=>(b.priority||0)-(a.priority||0)||a.runAt-b.runAt);
      for(const j of candidates.slice(0,Math.max(1,Number(limit)||1))){
        // Re-check immediately before writing the claim. This serializes claims
        // made through one store instance; cross-process locking remains separate.
        const current=this.jobsState.get(String(j.id));if(!current||current.status!=="queued")continue;
        const token=randomUUID(),fence=Number(current.leaseFence||0)+1;
        const patch={status:"running",attempts:Number(current.attempts)+1,leaseOwner:String(workerId),leaseToken:token,leaseFence:fence,leaseExpiresAt:now+Math.max(1000,Number(leaseMs)||45000),updatedAt:new Date().toISOString()};
        const r=await this.wal.append("job.transition",{id:current.id,patch});this.apply(r);out.push({...current,...patch});
      }
      return out;
    };
    const next=this.mutationChain.then(run,run);this.mutationChain=next.then(()=>undefined,()=>undefined);return next;
  }
  async transition(id,op,{leaseToken,leaseFence,leaseMs=45000,result=null,error=null,delayMs=1000,reason=""}={}){
    await this.refresh();const j=this.jobsState.get(String(id));if(!j||j.status!=="running"||j.leaseToken!==leaseToken||(leaseFence!=null&&Number(j.leaseFence)!==Number(leaseFence)))return false;
    let patch={updatedAt:new Date().toISOString()};
    if(op==="heartbeat")patch={...patch,leaseExpiresAt:Date.now()+Math.max(1000,Number(leaseMs)||45000)};
    if(op==="complete")patch={...patch,status:"completed",result:clone(result),leaseOwner:null,leaseToken:null,leaseExpiresAt:0,completedAt:new Date().toISOString()};
    if(op==="defer")patch={...patch,status:"queued",runAt:Date.now()+Math.max(1,Number(delayMs)||1),lastError:String(reason).slice(0,4000),leaseOwner:null,leaseToken:null,leaseExpiresAt:0};
    if(op==="fail"){const attempts=Number(j.attempts);const dead=attempts>=Number(j.maxAttempts);patch={...patch,status:dead?"dead":"queued",runAt:dead?j.runAt:Date.now()+Math.min(300000,(2**attempts)*1000+Math.random()*5000),lastError:String(error?.message||error||"Worker task failed").slice(0,4000),leaseOwner:null,leaseToken:null,leaseExpiresAt:0};}
    const r=await this.wal.append("job.transition",{id:j.id,patch});this.apply(r);return true;
  }
  async recoverExpired(limit=500){await this.refresh();let n=0;const now=Date.now();for(const j of [...this.jobsState.values()].filter(x=>x.status==="running"&&x.leaseExpiresAt<now).slice(0,limit)){const r=await this.wal.append("job.transition",{id:j.id,patch:{status:j.attempts>=j.maxAttempts?"dead":"queued",leaseOwner:null,leaseToken:null,leaseExpiresAt:0,recoveredCount:Number(j.recoveredCount||0)+1,lastError:"Worker lease expired; task reclaimed",runAt:Date.now()+1000,updatedAt:new Date().toISOString()}});this.apply(r);n++;}return n;}
  async snapshot(){await this.refresh();return {root:this.root,jobs:this.jobs(),state:[...this.state.values()].map(clone),wal:await this.wal.snapshot()};}
}
export const apexPureStore=new ApexPureStore();

/**
 * Backward-compatible file store API used by existing application modules.
 * Sovereign jobs use apexPureStore; legacy callers retain their read/write contract.
 */
export function createPureStore({ root = PROJECTS } = {}) {
  async function ensure() { await mkdir(root, { recursive: true }); }
  async function read(name, fallback = null) {
    await ensure();
    const base=await realpath(root);
    const file=path.resolve(base,String(name));
    if(file===base||!inside(base,file))throw new Error("[SECURITY_VIOLATION] Legacy store path escapes the configured root.");
    let parent=path.dirname(file);
    while(parent!==base&&inside(base,parent)){
      try{const info=await lstat(parent);if(info.isSymbolicLink())throw new Error("[SECURITY_VIOLATION] Symlink in legacy store path.");}catch(e){if(e.code!=="ENOENT")throw e;}
      parent=path.dirname(parent);
    }
    try{const info=await lstat(file);if(info.isSymbolicLink()||!info.isFile())throw new Error("[SECURITY_VIOLATION] Legacy store target must be a regular file.");}
    catch(e){if(e.code!=="ENOENT")throw e;}
    try { return JSON.parse(await readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
  }
  async function write(name, value) {
    await ensure();
    const base=await realpath(root);
    const file=path.resolve(base,String(name));
    if(file===base||!inside(base,file))throw new Error("[SECURITY_VIOLATION] Legacy store path escapes the configured root.");
    const parent=path.dirname(file);
    const relativeParent=path.relative(base,parent);
    let cursor=base;
    for(const segment of relativeParent.split(path.sep).filter(Boolean)){
      cursor=path.join(cursor,segment);
      await mkdir(cursor,{recursive:false,mode:0o700}).catch(error=>{if(error.code!=="EEXIST")throw error;});
      const info=await lstat(cursor);
      if(info.isSymbolicLink()||!info.isDirectory())throw new Error("[SECURITY_VIOLATION] Symlink or non-directory in legacy store path.");
    }
    try{const info=await lstat(file);if(info.isSymbolicLink()||!info.isFile())throw new Error("[SECURITY_VIOLATION] Legacy store target must be a regular file.");}
    catch(e){if(e.code!=="ENOENT")throw e;}
    const temp=file+'.'+process.pid+'.'+randomUUID()+'.tmp';
    const fh=await open(temp,'wx',0o600);
    try{await fh.writeFile(JSON.stringify(value,null,2)+'\n','utf8');await fh.sync();}finally{await fh.close();}
    await rename(temp,file);await syncDirectory(parent);
    return file;
  }
  return { root, ensure, read, write };
}
