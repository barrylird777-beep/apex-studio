import { mkdir, rename, writeFile, readFile, realpath, lstat, open, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { ApexRingWAL } from "./apex-ring-wal.mjs";
import { ContentAddressedStore } from "./content-addressed-store.mjs";
import { RemoteContentAddressedStore } from "./remote-content-addressed-store.mjs";
import { createHash } from "node:crypto";
import { PeerStorageApiClient } from "./peer-storage-api-client.mjs";

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
  constructor({root=PROJECTS,wal=null,cas=null,localCas=null,remoteWal=null,walScope="apex-pure-store"}={}){this.root=path.resolve(root);this.explicitCas=Boolean(cas);this.appNamespace=String(process.env.APEX_APP_NAMESPACE||"").trim();this.remoteMode=Boolean(cas)||Boolean(this.appNamespace)||String(process.env.APEX_CAS_REMOTE_ENABLED||"").toLowerCase()==="true";this.legacyWal=wal||new ApexRingWAL();this.localCas=localCas||new ContentAddressedStore({root:path.join(this.root,".apex-cas")});this.cas=cas||(this.appNamespace?new PeerStorageApiClient({app:this.appNamespace}):(this.remoteMode?new RemoteContentAddressedStore():this.localCas));this.wal=this.legacyWal;this.state=new Map();this.jobsState=new Map();this.ready=false;this.initPromise=null;this.remoteQueueIndexReady=false;this.remoteQueueIndexPromise=null;this.mutationChain=Promise.resolve();this.mutationContext=new AsyncLocalStorage();this.migrationFile=path.join(this.root,".apex-cas-migrated-v1.json");}
  async init(){
    if(this.ready)return this;
    if(this.initPromise)return this.initPromise;
    this.initPromise=this.initialize();
    try{return await this.initPromise;}
    catch(error){this.initPromise=null;throw error;}
  }
  async initialize(){
    if(!this.explicitCas&&!this.appNamespace)throw new Error("[SOVEREIGN_STORAGE_UNAVAILABLE] APEX_APP_NAMESPACE is required; local and legacy remote persistence fallback is disabled.");
    if(this.remoteMode){await this.initializeRemote();this.ready=true;return this;}
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
        if(handle){await handle.close().catch(()=>{});handle=undefined;}
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
        try{await stat(this.legacyWal.file);legacyExists=true;}catch(e){if(e.code!=="ENOENT")throw e;}
        if(legacyExists){
          const pendingState=new Map(),pendingJobs=new Map();
          const flushMigrationBatch=async()=>{
            const writes=[];
            for(const [key,value] of pendingState){
              if(value===null||value.deleted)writes.push(()=>this.cas.deleteRef("state",this.refKey(value.collection,value.id)));
              else writes.push(()=>this.cas.writeRef("state",this.refKey(value.collection,value.id),{collection:value.collection,id:value.id,record:clone(value.record)}));
            }
            for(const [id,job] of pendingJobs)writes.push(()=>this.cas.writeRef("jobs",this.refKey("job",id),{id,job:clone(job)}));
            await runBatched(writes,16,write=>write());
            pendingState.clear();pendingJobs.clear();
          };
          await this.legacyWal.replay({retainRing:false,onRecord:async r=>{
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
                job=current?.value?.job?clone(current.value.job):undefined;
              }
              if(job)pendingJobs.set(id,{...job,...clone(p.patch)});
            }
            if(pendingState.size+pendingJobs.size>=256)await flushMigrationBatch();
          }});
          await flushMigrationBatch();
        }
        await this.atomic(this.migrationFile,{version:1,storage:"content-addressed",migratedAt:new Date().toISOString(),legacyImported:legacyExists});
      }
      this.ready=true;
      // Do not scan the entire durable store during process startup. Reads and queue operations
      // refresh only the namespace they need; first boot still has migrated records in memory.
      return this;
    }finally{
      clearInterval(heartbeat);
      const owned=handle;handle=undefined;
      let ownsPath=false;
      try{
        const [opened,current,contents]=await Promise.all([owned.stat(),stat(lockFile),readFile(lockFile,"utf8")]);
        ownsPath=opened.dev===current.dev&&opened.ino===current.ino&&JSON.parse(contents).token===token;
      }catch(e){if(e.code!=="ENOENT"&&!(e instanceof SyntaxError))throw e;}
      await owned.close().catch(()=>{});
      if(ownsPath)await unlink(lockFile).catch(e=>{if(e.code!=="ENOENT")throw e;});
    }
  }
  async withRemoteLock(name,operation){
    const key=String(name),started=Date.now(),token=randomUUID();
    let currentHash=null,stopped=false,heartbeatChain=Promise.resolve();
    while(true){
      const current=await this.cas.readRef("system",key),now=Date.now();
      if(current&&Number(current.value?.leaseUntil||0)>now){
        if(now-started>180000)throw new Error("[REMOTE_STORE_LOCK] Timed out waiting for "+key);
        await sleep(40+Math.floor(Math.random()*80));continue;
      }
      try{const lock=await this.cas.writeRef("system",key,{token,leaseUntil:now+90000,owner:process.env.APEX_SERVICE_SCOPE||"apex"},{expectedHash:current?.hash??null});currentHash=lock.hash;break;}
      catch(error){if(error.code!=="CAS_CONFLICT")throw error;if(now-started>180000)throw new Error("[REMOTE_STORE_LOCK] Timed out acquiring "+key);await sleep(40+Math.floor(Math.random()*80));}
    }
    const heartbeat=setInterval(()=>{if(stopped)return;heartbeatChain=heartbeatChain.then(async()=>{if(stopped||!currentHash)return;const renewed=await this.cas.writeRef("system",key,{token,leaseUntil:Date.now()+90000,owner:process.env.APEX_SERVICE_SCOPE||"apex"},{expectedHash:currentHash});currentHash=renewed.hash;}).catch(error=>{console.error("[REMOTE_STORE_LOCK] lease renewal failed",String(error?.message||error).slice(0,250));});},20000);
    heartbeat.unref?.();
    try{return await operation();}
    finally{stopped=true;clearInterval(heartbeat);await heartbeatChain;if(currentHash)await this.cas.deleteRef("system",key,{expectedHash:currentHash}).catch(error=>{if(error.code!=="CAS_CONFLICT")console.error("[REMOTE_STORE_LOCK] release failed",String(error?.message||error).slice(0,250));});}
  }
  async initializeRemote(){
    const canonicalApps=new Set(["KernelVision","XShield","Kernelodies","PlanetApeX","KashKorner","KoinKob"]);
    const adapterNamespace=String(this.cas?.namespace||"");
    const requiredNamespace=this.appNamespace||adapterNamespace;
    if(!canonicalApps.has(requiredNamespace)||adapterNamespace!==requiredNamespace){
      throw new Error("[SOVEREIGN_STORAGE_UNAVAILABLE] A canonical, app-scoped peer CAS adapter is required; local and unscoped stores are rejected.");
    }
    if(!this.cas||typeof this.cas.init!=="function"||typeof this.cas.readRef!=="function"||
      typeof this.cas.writeRef!=="function"||typeof this.cas.listRefs!=="function"||
      typeof this.cas.deleteRef!=="function"){
      throw new Error("[SOVEREIGN_STORAGE_UNAVAILABLE] A complete peer-only CAS adapter is required.");
    }
    // No legacy WAL replay, local CAS import, JSON marker, disk lock, or fallback.
    await this.cas.init();
    await this.cas.listRefs("system");
    this.remoteQueueIndexReady=false;
    this.ready=true;
    return this;
  }
  async ensureRemoteQueueIndex({force=false}={}){
    if(!this.remoteMode)return {ready:true,indexed:0};
    if(this.remoteQueueIndexReady&&!force)return {ready:true,indexed:0};
    if(this.remoteQueueIndexPromise&&!force)return this.remoteQueueIndexPromise;
    this.remoteQueueIndexPromise=(async()=>{
      const markerKey="job-index-v3";
      // The current writer maintains queue/running indexes before committing
      // the corresponding job state, so ordinary process startup does not need
      // to serialize a full jobs-namespace scan. Explicit force=true remains
      // available for repairing legacy index gaps.
      const existingMarker=await this.cas.readRef("system",markerKey);
      if(!force&&Number(existingMarker?.value?.version)>=2){
        this.remoteQueueIndexReady=true;
        return {ready:true,indexed:0,version:Number(existingMarker.value.version),reconciled:false};
      }
      const result=await this.withRemoteLock("job-index-v3-migration-lock",async()=>{
        const marker=await this.cas.readRef("system",markerKey);
        if(!force&&Number(marker?.value?.version)>=2){
          this.remoteQueueIndexReady=true;
          return {ready:true,indexed:0,version:Number(marker.value.version),reconciled:false};
        }
        let indexed=0;
        const refs=await this.cas.listRefs("jobs");
        const dedupeRecords=new Map();
        for(const ref of refs){
          const job=ref.value?.job;
          if(!job||job.id==null||job.dedupeKey==null||!String(job.dedupeKey))continue;
          const key=createHash("sha256").update(String(job.dedupeKey)).digest("hex");
          const active=job.status==="queued"||job.status==="running";
          const previous=dedupeRecords.get(key);
          const previousActive=previous&&(previous.status==="queued"||previous.status==="running");
          if(!previous||active&&!previousActive||(active===Boolean(previousActive)&&String(job.updatedAt||"")>String(previous.updatedAt||""))){
            dedupeRecords.set(key,{dedupeKey:String(job.dedupeKey),id:String(job.id),status:String(job.status||""),type:String(job.type||""),updatedAt:String(job.updatedAt||"")});
          }
        }
        const dedupeItems=[...dedupeRecords.entries()];
        for(let offset=0;offset<dedupeItems.length;offset+=32){
          await Promise.all(dedupeItems.slice(offset,offset+32).map(([key,value])=>this.cas.writeRef("dedupe",key,value)));
        }
        for(let offset=0;offset<refs.length;offset+=32){
          const batch=refs.slice(offset,offset+32);
          const counts=await Promise.all(batch.map(async ref=>{
            const job=ref.value?.job;
            if(!job||job.id==null)return 0;
            const key=this.refKey("job",job.id);
            const current=await this.cas.readRef("queue",key);
            if(job.status==="queued"){
              const value={id:String(job.id),runAt:Number(job.runAt)||0,priority:Number(job.priority)||0,role:String(job.payload?._apex_worker?.role||""),dedupeKey:job.dedupeKey==null?null:String(job.dedupeKey),updatedAt:String(job.updatedAt||"")};
              if(!current||JSON.stringify(current.value)!==JSON.stringify(value))await this.cas.writeRef("queue",key,value,{expectedHash:current?.hash??null});
              const running=await this.cas.readRef("running",key);
              if(running)await this.cas.deleteRef("running",key,{expectedHash:running.hash});
              return 1;
            }
            if(job.status==="running"){
              const value={id:String(job.id),leaseExpiresAt:Number(job.leaseExpiresAt)||0,priority:Number(job.priority)||0,role:String(job.payload?._apex_worker?.role||""),dedupeKey:job.dedupeKey==null?null:String(job.dedupeKey),updatedAt:String(job.updatedAt||"")};
              const running=await this.cas.readRef("running",key);
              if(!running||JSON.stringify(running.value)!==JSON.stringify(value))await this.cas.writeRef("running",key,value,{expectedHash:running?.hash??null});
              if(current)await this.cas.deleteRef("queue",key,{expectedHash:current.hash});
              return 1;
            }
            if(current)await this.cas.deleteRef("queue",key,{expectedHash:current.hash});
            const running=await this.cas.readRef("running",key);
            if(running)await this.cas.deleteRef("running",key,{expectedHash:running.hash});
            return 0;
          }));
          indexed+=counts.reduce((sum,count)=>sum+count,0);
        }
        await this.cas.writeRef("system",markerKey,{version:2,storage:"remote-queue-index",indexed,createdAt:new Date().toISOString()},{expectedHash:marker?.hash??null});
        this.remoteQueueIndexReady=true;
        return {ready:true,indexed,version:2};
      });
      this.remoteQueueIndexReady=true;
      return result;
    })();
    try{return await this.remoteQueueIndexPromise;}
    catch(error){this.remoteQueueIndexPromise=null;throw error;}
    finally{this.remoteQueueIndexPromise=null;}
  }
  async loadStateReferences(){
    this.state.clear();
    for(const ref of await this.cas.listRefs("state")){const v=ref.value;if(v?.collection&&v?.id!=null&&!v.deleted)this.state.set(this.key(v.collection,v.id),clone(v.record));}
  }
  async loadJobReferences(){
    this.jobsState.clear();
    for(const ref of await this.cas.listRefs("jobs")){const v=ref.value;if(v?.id!=null&&v?.job)this.jobsState.set(String(v.id),clone(v.job));}
  }
  async loadReferences(){await Promise.all([this.loadStateReferences(),this.loadJobReferences()]);}
  async refreshState(){await this.init();await this.loadStateReferences();return this;}
  async refreshJobs(){await this.init();await this.loadJobReferences();return this;}
  async refresh(){await this.init();await this.loadReferences();return this;}
  refKey(collection,id){safeSegment(collection,"collection");safeSegment(id,"record id");return createHash("sha256").update(String(collection)+"::"+String(id)).digest("hex");}
  async persistJob(job,{appendWal=true,walSeq=null}={}) {
    const effectiveJob=clone(job);
    if(!this.remoteMode){
      const key=this.refKey("job",effectiveJob.id);
      await this.cas.writeRef("jobs",key,{id:String(effectiveJob.id),job:clone(effectiveJob)});
      return clone(effectiveJob);
    }
    const key=this.refKey("job",effectiveJob.id);
    // Publish the searchable index before committing queued/running state. If a
    // process dies between these writes, readers revalidate the job record and
    // discard the stale index; a committed active job cannot be left unindexed.
    if(effectiveJob.status==="queued"){
      const value={id:String(effectiveJob.id),runAt:Number(effectiveJob.runAt)||0,priority:Number(effectiveJob.priority)||0,role:String(effectiveJob.payload?._apex_worker?.role||""),dedupeKey:effectiveJob.dedupeKey==null?null:String(effectiveJob.dedupeKey),updatedAt:String(effectiveJob.updatedAt||"")};
      const current=await this.cas.readRef("queue",key);
      if(!current||JSON.stringify(current.value)!==JSON.stringify(value))await this.cas.writeRef("queue",key,value,{expectedHash:current?.hash??null});
    }else if(effectiveJob.status==="running"){
      const value={id:String(effectiveJob.id),leaseExpiresAt:Number(effectiveJob.leaseExpiresAt)||0,priority:Number(effectiveJob.priority)||0,role:String(effectiveJob.payload?._apex_worker?.role||""),dedupeKey:effectiveJob.dedupeKey==null?null:String(effectiveJob.dedupeKey),updatedAt:String(effectiveJob.updatedAt||"")};
      const current=await this.cas.readRef("running",key);
      if(!current||JSON.stringify(current.value)!==JSON.stringify(value))await this.cas.writeRef("running",key,value,{expectedHash:current?.hash??null});
    }
    let persisted=false;
    for(let attempt=0;attempt<8;attempt++){
      const current=await this.cas.readRef("jobs",key);
      try{
        await this.cas.writeRef("jobs",key,{id:String(effectiveJob.id),job:clone(effectiveJob)},{expectedHash:current?.hash??null});
        persisted=true;break;
      }catch(error){if(error.code!=="CAS_CONFLICT"||attempt===7)throw error;}
    }
    if(!persisted)throw new Error("[REMOTE_STORE_CAS] Could not persist job state.");
    if(effectiveJob.dedupeKey!=null&&String(effectiveJob.dedupeKey)){
      const dedupeKey=createHash("sha256").update(String(effectiveJob.dedupeKey)).digest("hex");
      const current=await this.cas.readRef("dedupe",dedupeKey);
      await this.cas.writeRef("dedupe",dedupeKey,{dedupeKey:String(effectiveJob.dedupeKey),id:String(effectiveJob.id),status:String(effectiveJob.status||""),type:String(effectiveJob.type||""),updatedAt:String(effectiveJob.updatedAt||"")},{expectedHash:current?.hash??null}).catch(async error=>{
        if(error.code!=="CAS_CONFLICT")throw error;
        const latest=await this.cas.readRef("dedupe",dedupeKey);
        if(latest?.value?.id!==String(effectiveJob.id))throw error;
        await this.cas.writeRef("dedupe",dedupeKey,{dedupeKey:String(effectiveJob.dedupeKey),id:String(effectiveJob.id),status:String(effectiveJob.status||""),type:String(effectiveJob.type||""),updatedAt:String(effectiveJob.updatedAt||"")},{expectedHash:latest.hash});
      });
    }
    const current=await this.cas.readRef("queue",key);
    const running=await this.cas.readRef("running",key);
    if(effectiveJob.status==="queued"){
      const value={id:String(effectiveJob.id),runAt:Number(effectiveJob.runAt)||0,priority:Number(effectiveJob.priority)||0,role:String(effectiveJob.payload?._apex_worker?.role||""),dedupeKey:effectiveJob.dedupeKey==null?null:String(effectiveJob.dedupeKey),updatedAt:String(effectiveJob.updatedAt||"")};
      if(!current||JSON.stringify(current.value)!==JSON.stringify(value))await this.cas.writeRef("queue",key,value,{expectedHash:current?.hash??null});
      if(running)await this.cas.deleteRef("running",key,{expectedHash:running.hash});
    }else if(effectiveJob.status==="running"){
      const value={id:String(effectiveJob.id),leaseExpiresAt:Number(effectiveJob.leaseExpiresAt)||0,priority:Number(effectiveJob.priority)||0,role:String(effectiveJob.payload?._apex_worker?.role||""),dedupeKey:effectiveJob.dedupeKey==null?null:String(effectiveJob.dedupeKey),updatedAt:String(effectiveJob.updatedAt||"")};
      if(!running||JSON.stringify(running.value)!==JSON.stringify(value))await this.cas.writeRef("running",key,value,{expectedHash:running?.hash??null});
      if(current)await this.cas.deleteRef("queue",key,{expectedHash:current.hash});
    }else{
      if(current)await this.cas.deleteRef("queue",key,{expectedHash:current.hash});
      if(running)await this.cas.deleteRef("running",key,{expectedHash:running.hash});
    }
    return clone(effectiveJob);
  }
  async persistState(collection,id,record,{appendWal=true,walSeq=null}={}) {
    const key=this.refKey(collection,id),value={collection:String(collection),id:String(id),record:clone(record)};
    if(!this.remoteMode){await this.cas.writeRef("state",key,value);return value;}
    for(let attempt=0;attempt<8;attempt++){
      const current=await this.cas.readRef("state",key);
      try{
        const stored={...value};
        await this.cas.writeRef("state",key,stored,{expectedHash:current?.hash??null});
        return stored;
      }catch(error){if(error.code!=="CAS_CONFLICT"||attempt===7)throw error;}
    }
    throw new Error("[REMOTE_STORE_CAS] Could not persist state.");
  }
  async persistDelete(collection,id,{appendWal=true,walSeq=null}={}) {
    const key=this.refKey(collection,id);
    if(!this.remoteMode){
      const current=await this.cas.readRef("state",key);
      if(current)await this.cas.deleteRef("state",key,{expectedHash:current.hash});
      return true;
    }
    for(let attempt=0;attempt<8;attempt++){
      const current=await this.cas.readRef("state",key);
      if(!current||current.value?.deleted)return true;
      try{
        await this.cas.writeRef("state",key,{collection:String(collection),id:String(id),deleted:true},{expectedHash:current.hash});
        return true;
      }catch(error){if(error.code!=="CAS_CONFLICT"||attempt===7)throw error;}
    }
    throw new Error("[REMOTE_STORE_CAS] Could not persist deletion.");
  }
  async withMutationLock(operation){
    // Reentrant for nested mutations in the same async call chain; otherwise a
    // nested acquisition waits on its own lock until the global timeout.
    if(this.mutationContext.getStore()===this)return operation();
    return this.mutationContext.run(this,async()=>{
    if(this.remoteMode)return this.withRemoteLock("queue-mutations",operation);
    await mkdir(this.root,{recursive:true,mode:0o700});
    const lockFile=path.join(this.root,".apex-queue-mutations.lock");
    const started=Date.now();
    let handle, token;
    while(true){
      try{
        token=randomUUID();
        handle=await open(lockFile,"wx",0o600);
        await handle.writeFile(JSON.stringify({pid:process.pid,createdAt:Date.now(),token}),"utf8");
        await handle.sync();
        break;
      }catch(error){
        if(handle){await handle.close().catch(()=>{});handle=undefined;}
        if(error.code!=="EEXIST")throw error;
        let stale=false;
        try{stale=Date.now()-(await stat(lockFile)).mtimeMs>120000;}
        catch(e){if(e.code==="ENOENT")continue;throw e;}
        if(stale){
          const quarantine=lockFile+".stale."+randomUUID();
          try{await rename(lockFile,quarantine);await unlink(quarantine).catch(e=>{if(e.code!=="ENOENT")throw e;});}
          catch(e){if(e.code!=="ENOENT"&&e.code!=="EEXIST")throw e;}
          continue;
        }
        if(Date.now()-started>180000)throw new Error("[STORE_LOCK] Timed out waiting for the shared queue mutation lock.");
        await sleep(20+Math.floor(Math.random()*31));
      }
    }
    const heartbeat=setInterval(()=>{const now=new Date();handle?.utimes(now,now).catch(()=>{});},10000);
    heartbeat.unref?.();
    try{return await operation();}
    finally{
      clearInterval(heartbeat);
      const ownedHandle=handle;
      handle=undefined;
      let ownsPath=false;
      try{
        const [opened,current,contents]=await Promise.all([ownedHandle.stat(),stat(lockFile),readFile(lockFile,"utf8")]);
        ownsPath=opened.dev===current.dev&&opened.ino===current.ino&&JSON.parse(contents).token===token;
      }catch(e){if(e.code!=="ENOENT"&&!(e instanceof SyntaxError))throw e;}
      await ownedHandle.close().catch(()=>{});
      if(ownsPath)await unlink(lockFile).catch(e=>{if(e.code!=="ENOENT")throw e;});
    }
    });
  }
  key(c,id){safeSegment(c,"collection");safeSegment(id,"record id");return String(c)+"::"+String(id);}
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
  file(c,id){return path.join(this.root,safeSegment(c,"collection"),safeSegment(id,"record id")+".json");}
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
    await this.init();
    const run=async()=>{
      const target=this.remoteMode?null:await this.checkedFile(collection,id,{createDir:true});
      const value={...clone(record),id:String(id),updatedAt:new Date().toISOString()};
      await this.persistState(collection,id,value);
      this.apply({type:"state.put",payload:{collection:String(collection),id:String(id),record:value}});
      if(!this.remoteMode)await this.atomic(target,value);
      return clone(value);
    };
    return this.remoteMode?this.withMutationLock(run):run();
  }
  async create(collection,record={}){const id=String(record.id||randomUUID());return this.put(collection,id,{...record,id});}
  async get(collection,id){await this.init();const key=this.key(collection,id);const ref=await this.cas.readRef("state",this.refKey(collection,id));const v=ref?.value;if(v?.collection&&v?.id!=null&&!v.deleted){this.state.set(key,clone(v.record));return clone(v.record);}this.state.delete(key);return null;}
  async list(collection){await this.refreshState();return [...this.state.entries()].filter(([k])=>k.startsWith(String(collection)+"::")).map(([,v])=>clone(v));}
  async query(collection,predicate=()=>true,{sort,limit=10000}={}){let rows=(await this.list(collection)).filter(predicate);if(sort)rows.sort(sort);return rows.slice(0,Math.max(1,Number(limit)||10000));}
  async delete(collection,id){
    await this.init();
    const run=async()=>{
      const target=this.remoteMode?null:await this.checkedFile(collection,id);
      if(this.remoteMode){
        await this.persistDelete(collection,id);
        this.state.delete(this.key(collection,id));
        return true;
      }
      await this.cas.deleteRef("state",this.refKey(collection,id));
      this.state.delete(this.key(collection,id));
      const { unlink }=await import("node:fs/promises");
      try{await unlink(target);await syncDirectory(path.dirname(target));}catch(e){if(e.code!=="ENOENT")throw e;}
      return true;
    };
    return this.remoteMode?this.withMutationLock(run):run();
  }
  async enqueue({id=randomUUID(),type,payload={},runAt=Date.now(),maxAttempts=5,dedupeKey=null,priority=0}={}){
    if(!type)throw new Error("job type required");
    if(this.remoteMode&&dedupeKey)await this.ensureRemoteQueueIndex();
    const run=()=>this.withMutationLock(async()=>{
      if(dedupeKey){
        const statuses=type==="sovereign.app.dispatch"?["queued","running","completed","dead"]:["queued","running"];
        let existing;
        if(this.remoteMode){
          const dedupeKeyHash=createHash("sha256").update(String(dedupeKey)).digest("hex");
          const candidate=await this.cas.readRef("dedupe",dedupeKeyHash);
          if(candidate&&candidate.value?.dedupeKey===String(dedupeKey)){
            const ref=await this.cas.readRef("jobs",this.refKey("job",candidate.value.id));
            const job=ref?.value?.job;
            if(job&&statuses.includes(job.status))existing=job;
          }
        }else{
          await this.refreshJobs();
          existing=[...this.jobsState.values()].find(j=>j.dedupeKey===String(dedupeKey)&&statuses.includes(j.status));
        }
        if(existing)return {durable:true,id:existing.id,duplicate:true,status:existing.status};
      }
      const job={id:String(id),type:String(type),payload:clone(payload),priority:Number(priority)||0,status:"queued",attempts:0,maxAttempts:Math.max(1,Number(maxAttempts)||5),dedupeKey:dedupeKey?String(dedupeKey):null,runAt:Number(runAt)||Date.now(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),leaseOwner:null,leaseToken:null,leaseFence:0,leaseExpiresAt:0,recoveredCount:0};
      const persisted=await this.persistJob(job);
      this.jobsState.set(String(persisted.id),clone(persisted));
      return {durable:true,id:persisted.id,duplicate:persisted.id!==job.id||persisted.createdAt!==job.createdAt,status:persisted.status};
    });
    const next=this.mutationChain.then(run,run);this.mutationChain=next.then(()=>undefined,()=>undefined);return next;
  }
  jobs(){return [...this.jobsState.values()].map(clone);}
  async claim({workerId="local",limit=1,leaseMs=45000,role=null,onlyId=null}={}){
    if(this.remoteMode)await this.ensureRemoteQueueIndex();
    // Listing the remote queue can require many object-store reads. Do it before
    // acquiring the global mutation lease; each candidate is revalidated under
    // the lease below, so a stale snapshot cannot claim a job twice.
    const indexedQueueRefs=this.remoteMode?await this.cas.listRefs("queue"):null;
    const run=()=>this.withMutationLock(async()=>{
      const now=Date.now(),out=[];
      let candidates;
      if(this.remoteMode){
        candidates=indexedQueueRefs.map(ref=>({indexKey:ref.key,indexHash:ref.hash,index:ref.value})).filter(item=>
          item.index&&Number(item.index.runAt||0)<=now&&
          (onlyId==null||String(item.index.id)===String(onlyId))&&
          (role?item.index.role===role:item.index.role!=="sovereign-runtime")
        ).sort((a,b)=>(Number(b.index.priority)||0)-(Number(a.index.priority)||0)||(Number(a.index.runAt)||0)-(Number(b.index.runAt)||0));
      }else{
        await this.refreshJobs();
        candidates=[...this.jobsState.values()].filter(j=>j.status==="queued"&&j.attempts<j.maxAttempts&&j.runAt<=now&&(onlyId==null||String(j.id)===String(onlyId))&&(role?j.payload?._apex_worker?.role===role:j.payload?._apex_worker?.role!=="sovereign-runtime")).sort((a,b)=>(b.priority||0)-(a.priority||0)||a.runAt-b.runAt);
      }
      for(const candidate of candidates){
        if(out.length>=Math.max(1,Number(limit)||1))break;
        let current;
        if(this.remoteMode){
          const ref=await this.cas.readRef("jobs",this.refKey("job",candidate.index.id));
          current=ref?.value?.job;
          if(!current||current.status!=="queued"||Number(current.runAt||0)>now||Number(current.attempts||0)>=Number(current.maxAttempts||5)){
            await this.cas.deleteRef("queue",candidate.indexKey,{expectedHash:candidate.indexHash}).catch(error=>{if(error.code!=="CAS_CONFLICT")throw error;});
            continue;
          }
          const currentRole=String(current.payload?._apex_worker?.role||"");
          if(role?currentRole!==role:currentRole==="sovereign-runtime")continue;
          this.jobsState.set(String(current.id),clone(current));
        }else{
          current=this.jobsState.get(String(candidate.id));
        }
        if(!current||current.status!=="queued")continue;
        const token=randomUUID(),fence=Number(current.leaseFence||0)+1;
        const patch={status:"running",attempts:Number(current.attempts)+1,leaseOwner:String(workerId),leaseToken:token,leaseFence:fence,leaseExpiresAt:now+Math.max(1000,Number(leaseMs)||45000),updatedAt:new Date().toISOString()};
        const updated={...current,...patch};
        const persisted=await this.persistJob(updated);
        this.jobsState.set(String(persisted.id),clone(persisted));out.push(persisted);
      }
      return out;
    });
    const next=this.mutationChain.then(run,run);this.mutationChain=next.then(()=>undefined,()=>undefined);return next;
  }
  async transition(id,op,{leaseToken,leaseFence,leaseMs=45000,result=null,error=null,delayMs=1000,reason=""}={}){
    return this.withMutationLock(async()=>{
      let j;
      if(this.remoteMode){
        const ref=await this.cas.readRef("jobs",this.refKey("job",id));
        j=ref?.value?.job;
        if(j)this.jobsState.set(String(id),clone(j));
      }else{
        await this.refreshJobs();j=this.jobsState.get(String(id));
      }
      if(!j||j.status!=="running"||j.leaseToken!==leaseToken||(leaseFence!=null&&Number(j.leaseFence)!==Number(leaseFence))||Number(j.leaseExpiresAt||0)<=Date.now())return false;
      let patch={updatedAt:new Date().toISOString()};
      if(op==="heartbeat")patch={...patch,leaseExpiresAt:Date.now()+Math.max(1000,Number(leaseMs)||45000)};
      if(op==="complete")patch={...patch,status:"completed",result:clone(result),leaseOwner:null,leaseToken:null,leaseExpiresAt:0,completedAt:new Date().toISOString()};
      if(op==="defer")patch={...patch,status:"queued",runAt:Date.now()+Math.max(1,Number(delayMs)||1),lastError:String(reason).slice(0,4000),leaseOwner:null,leaseToken:null,leaseExpiresAt:0};
      if(op==="fail"){const attempts=Number(j.attempts);const dead=attempts>=Number(j.maxAttempts);patch={...patch,status:dead?"dead":"queued",runAt:dead?j.runAt:Date.now()+Math.min(300000,(2**attempts)*1000+Math.random()*5000),lastError:String(error?.message||error||"Worker task failed").slice(0,4000),leaseOwner:null,leaseToken:null,leaseExpiresAt:0};}
      const persisted=await this.persistJob({...j,...patch});
      this.jobsState.set(String(persisted.id),clone(persisted));return true;
    });
  }
  async recoverExpired(limit=25){
    // The running-index scan is also remote I/O. Snapshot it outside the global
    // mutation lease, then re-read each job under the lease before changing it.
    const runningIndexRefs=this.remoteMode?await this.cas.listRefs("running"):null;
    return this.withMutationLock(async()=>{
      let candidates;
      if(this.remoteMode){
        candidates=runningIndexRefs.filter(ref=>Number(ref.value?.leaseExpiresAt||0)<Date.now()).sort((a,b)=>Number(a.value?.leaseExpiresAt||0)-Number(b.value?.leaseExpiresAt||0)).slice(0,Math.max(1,Math.min(25,Number(limit)||25))).map(ref=>({indexKey:ref.key,indexHash:ref.hash,index:ref.value}));
      }else{
        await this.refreshJobs();
        candidates=[...this.jobsState.values()].filter(x=>x.status==="running"&&x.leaseExpiresAt<Date.now()).slice(0,Math.max(1,Math.min(25,Number(limit)||25))).map(job=>({index:job}));
      }
      let n=0;const now=Date.now();
      for(const candidate of candidates){
        const ref=this.remoteMode?await this.cas.readRef("jobs",this.refKey("job",candidate.index.id)):null;
        const j=this.remoteMode?ref?.value?.job:candidate.index;
        if(!j||j.status!=="running"||Number(j.leaseExpiresAt||0)>=now)continue;
        this.jobsState.set(String(j.id),clone(j));
        const patch={status:j.attempts>=j.maxAttempts?"dead":"queued",leaseOwner:null,leaseToken:null,leaseExpiresAt:0,recoveredCount:Number(j.recoveredCount||0)+1,lastError:"Worker lease expired; task reclaimed",runAt:Date.now()+1000,updatedAt:new Date().toISOString()};
        const persisted=await this.persistJob({...j,...patch});
        this.jobsState.set(String(persisted.id),clone(persisted));n++;
      }
      return n;
    });
  }
  async snapshot(){await this.refresh();return {root:this.root,storage:"content-addressed",jobs:this.jobs(),state:[...this.state.values()].map(clone)};}
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
