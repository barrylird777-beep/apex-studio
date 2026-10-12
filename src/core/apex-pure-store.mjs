import { mkdir, rename, writeFile, readFile, realpath, lstat, open, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ApexRingWAL } from "./apex-ring-wal.mjs";
import { ContentAddressedStore } from "./content-addressed-store.mjs";
import { createHash } from "node:crypto";

const ROOT=process.env.APEX_SE_X_ROOT||"/srv/apex/se-x";
const PROJECTS=process.env.APEX_PROJECTS_DIR||path.join(ROOT,"projects");
const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function runBatched(items,batchSize,worker){for(let i=0;i<items.length;i+=batchSize)await Promise.all(items.slice(i,i+batchSize).map(worker));}
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
  constructor({root=PROJECTS,wal=new ApexRingWAL()}={}){this.root=path.resolve(root);this.wal=wal;this.cas=new ContentAddressedStore({root:path.join(this.root,".apex-cas")});this.state=new Map();this.jobsState=new Map();this.ready=false;this.initPromise=null;this.mutationChain=Promise.resolve();this.migrationFile=path.join(this.root,".apex-cas-migrated-v1.json");}
  async init(){
    if(this.ready)return this;
    if(this.initPromise)return this.initPromise;
    this.initPromise=this.initialize();
    try{return await this.initPromise;}
    catch(error){this.initPromise=null;throw error;}
  }
  async initialize(){
    await mkdir(this.root,{recursive:true,mode:0o700});
    await this.cas.init();
    const lockFile=path.join(this.root,".apex-cas-migration.lock");
    const markerExists=async()=>{try{await stat(this.migrationFile);return true;}catch(e){if(e.code==="ENOENT")return false;throw e;}};
    const started=Date.now();
    let handle,token;
    while(!handle){
      if(await markerExists()){this.ready=true;return this;}
      try{
        token=randomUUID();
        handle=await open(lockFile,"wx",0o600);
        await handle.writeFile(JSON.stringify({pid:process.pid,createdAt:Date.now(),token}),"utf8");
        await handle.sync();
      }catch(error){
        // Keep an exclusively created inode lock if ENOSPC blocks metadata bytes.
        if(error.code==="ENOSPC"&&handle){await handle.sync().catch(()=>{});break;}
        if(handle){
          // If lock creation succeeded but metadata write failed (for example ENOSPC),
          // remove only the exact inode created by this attempt before retrying.
          try{
            const [opened,current]=await Promise.all([handle.stat(),stat(lockFile)]);
            if(opened.dev===current.dev&&opened.ino===current.ino)await unlink(lockFile).catch(e=>{if(e.code!=="ENOENT")throw e;});
          }catch(cleanupError){if(cleanupError.code!=="ENOENT"){}}
          await handle.close().catch(()=>{});handle=undefined;
        }
        if(error.code!=="EEXIST")throw error;
        let stale=false;
        try{stale=Date.now()-(await stat(lockFile)).mtimeMs>30000;}
        catch(e){if(e.code==="ENOENT")continue;throw e;}
        if(stale){
          const quarantine=lockFile+".stale."+randomUUID();
          try{await rename(lockFile,quarantine);await unlink(quarantine).catch(e=>{if(e.code!=="ENOENT")throw e;});}
          catch(e){if(e.code!=="ENOENT"&&e.code!=="EEXIST")throw e;}
          continue;
        }
        if(Date.now()-started>600000)throw new Error("[STORE_MIGRATION] Timed out waiting for the cross-process migration lock.");
        await sleep(50+Math.floor(Math.random()*50));
      }
    }
    const heartbeat=setInterval(()=>{const now=new Date();handle?.utimes(now,now).catch(()=>{});},10000);
    heartbeat.unref?.();
    try{
      if(!await markerExists()){
        let legacyExists=false;
        try{await stat(this.wal.file);legacyExists=true;}catch(e){if(e.code!=="ENOENT")throw e;}
        if(legacyExists){
          const pendingState=new Map(),pendingJobs=new Map();
          const flushMigrationBatch=async()=>{
            const writes=[];
            for(const [key,value] of pendingState){
              if(value===null||value.deleted)writes.push(()=>this.cas.deleteRef("state",this.refKey(value.collection,value.id)));
              else writes.push(async()=>{
                const refKey=this.refKey(value.collection,value.id);
                const stored={collection:value.collection,id:value.id,record:clone(value.record)};
                const current=await this.cas.readRef("state",refKey);
                if(current&&JSON.stringify(current.value)===JSON.stringify(stored)){
                  // Verify/offload the immutable object without rewriting its local manifest.
                  await this.cas.putObject(stored);
                  return;
                }
                await this.cas.writeRef("state",refKey,stored);
              });
            }
            for(const [id,job] of pendingJobs)writes.push(async()=>{
              const refKey=this.refKey("job",id);
              const stored={id,job:clone(job)};
              const current=await this.cas.readRef("jobs",refKey);
              if(current&&JSON.stringify(current.value)===JSON.stringify(stored)){
                await this.cas.putObject(stored);
                return;
              }
              await this.cas.writeRef("jobs",refKey,stored);
            });
            await runBatched(writes,16,write=>write());
            pendingState.clear();pendingJobs.clear();
          };
          await this.wal.replay({retainRing:false,onRecord:async r=>{
            const p=r.payload||{};
            if(r.type==="state.put"){
              const collection=String(p.collection),id=String(p.id);
              pendingState.set(this.key(collection,id),{collection,id,record:clone(p.record)});
            }else if(r.type==="state.delete"){
              const collection=String(p.collection),id=String(p.id);
              pendingState.set(this.key(collection,id),{collection,id,deleted:true});
            }else if(r.type==="job.enqueue"){
              pendingJobs.set(String(p.id),clone(p.job));
            }else if(r.type==="job.transition"){
              const id=String(p.id);
              let job=pendingJobs.get(id);
              if(!pendingJobs.has(id)){
                const current=await this.cas.readRef("jobs",this.refKey("job",id));