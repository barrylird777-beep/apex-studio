import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';

const ROOT = process.env.APEX_SEX_ROOT || '/srv/apex/se-x';
const WAL_DIR = process.env.APEX_WAL_DIR || path.join(ROOT, 'wal');
const PROJECT_DIR = process.env.APEX_PROJECT_DIR || path.join(ROOT, 'projects');
const LOCK_DIR = path.join(WAL_DIR, '.locks');
const SEGMENT_BYTES = Math.max(1024 * 1024, Number(process.env.APEX_WAL_SEGMENT_BYTES || 64 * 1024 * 1024));
const LOCK_STALE_MS = Math.max(5000, Number(process.env.APEX_FILE_LOCK_STALE_MS || 120000));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const stable = value => JSON.stringify(normalize(value));
function normalize(value) { if (Array.isArray(value)) return value.map(normalize); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, normalize(value[k])])); return value; }
function digest(record) { return createHash('sha256').update(stable({seq:record.seq,stream:record.stream,type:record.type,id:record.id,ts:record.ts,payload:record.payload,prev:record.prev || null})).digest('hex'); }

async function mkdirs() { await Promise.all([fs.mkdir(WAL_DIR,{recursive:true,mode:0o700}),fs.mkdir(PROJECT_DIR,{recursive:true,mode:0o700}),fs.mkdir(LOCK_DIR,{recursive:true,mode:0o700})]); }
async function withFileLock(name, fn, options={}) {
  await mkdirs(); const lockPath=path.join(LOCK_DIR,name+'.lock'); const timeout=Number(options.timeoutMs||30000); const deadline=Date.now()+timeout; let handle;
  while(!handle){ try{handle=await fs.open(lockPath,'wx',0o600);await handle.writeFile(JSON.stringify({pid:process.pid,host:os.hostname(),acquiredAt:Date.now()}));}catch(error){if(error.code!=='EEXIST'||Date.now()>=deadline)throw error;try{const stat=await fs.stat(lockPath);if(Date.now()-stat.mtimeMs>LOCK_STALE_MS)await fs.unlink(lockPath);}catch{}await sleep(Math.min(100,Math.max(5,deadline-Date.now())));}}
  try{return await fn();}finally{await handle.close().catch(()=>{});await fs.unlink(lockPath).catch(()=>{});}
}
async function segments(){ await mkdirs(); const names=(await fs.readdir(WAL_DIR)).filter(name=>/^wal-\d{20}\.jsonl$/.test(name)).sort(); return names.length?names:['wal-00000000000000000001.jsonl']; }
async function activeSegment(){ const names=await segments();const name=names.at(-1);const full=path.join(WAL_DIR,name);let size=0;try{size=(await fs.stat(full)).size;}catch{}if(size<SEGMENT_BYTES)return {name,full,size};const next=Number(name.slice(4,-6))+1;const nextName='wal-'+String(next).padStart(20,'0')+'.jsonl';return {name:nextName,full:path.join(WAL_DIR,nextName),size:0}; }

export async function replay({verify=true}={}){
  const state=new Map();let last=null;
  for(const name of await segments()){const full=path.join(WAL_DIR,name);const raw=await fs.readFile(full,'utf8').catch(e=>e.code==='ENOENT'?'':Promise.reject(e));for(const [i,line] of raw.split('\n').entries()){const text=line.trim();if(!text)continue;let record;try{record=JSON.parse(text);}catch(e){throw new Error('WAL parse failure at '+name+':'+(i+1)+': '+e.message);}if(verify&&digest(record)!==record.checksum)throw new Error('WAL checksum failure at '+name+':'+(i+1));if(verify&&last&&record.prev!==last.checksum)throw new Error('WAL chain failure at '+name+':'+(i+1));last=record;state.set(record.id,record);}}
  return {state,last};
}
async function appendEventUnlocked(type,payload={},options={}){const current=await replay({verify:true});const previous=current.last;const record={seq:(previous?.seq||0)+1,stream:options.stream||'apex',type,id:options.id||payload.id||randomUUID(),ts:new Date().toISOString(),payload,prev:previous?.checksum||null};record.checksum=digest(record);const segment=await activeSegment();const handle=await fs.open(segment.full,'a',0o600);try{await handle.write(stable(record)+'\n',null,'utf8');await handle.sync();}finally{await handle.close();}return record;}
export async function appendEvent(type,payload={},options={}){return withFileLock('append',()=>appendEventUnlocked(type,payload,options));}

export async function enqueueJob(job){const id=job.id||randomUUID();return appendEvent('job.enqueue',{...job,id,status:'queued',attempts:Number(job.attempts||0),maxAttempts:Number(job.maxAttempts||3),runAt:job.runAt||new Date().toISOString()},{id,stream:'jobs'});}
export async function claimJobs({workerId,limit=Infinity,leaseMs=60000}={}){return withFileLock('append',async()=>{const {state}=await replay();const now=Date.now();const candidates=[];for(const event of state.values()){if(!event.payload||event.stream!=='jobs')continue;if(!['job.enqueue','job.retry','job.recovered'].includes(event.type))continue;const job=event.payload;if(job.status!=='queued'||Date.parse(job.runAt||0)>now)continue;candidates.push(job);}const results=[];for(const job of candidates.slice(0,Number.isFinite(limit)?Math.max(0,limit):candidates.length)){const payload={...job,status:'running',workerId,leaseToken:randomUUID(),fence:Number(job.fence||0)+1,lockedAt:new Date().toISOString(),leaseUntil:new Date(Date.now()+leaseMs).toISOString()};const event=await appendEventUnlocked('job.claim',payload,{id:job.id,stream:'jobs'});results.push(event.payload);}return results;});}
async function assertJobFence(job){
  if(!job?.id||!job?.leaseToken) throw new Error('job lease token required');
  const {state}=await replay({verify:true});
  const current=[...state.values()].find(event=>event.stream==='jobs'&&event.id===job.id)?.payload;
  if(!current||current.status!=='running'||current.leaseToken!==job.leaseToken||Number(current.fence)!==Number(job.fence)) throw new Error('stale or fenced job lease');
  if(current.leaseUntil&&Date.parse(current.leaseUntil)<=Date.now()) throw new Error('job lease expired');
  return current;
}
export async function renewJobLease(job, leaseMs=60000){
  return withFileLock('append',async()=>{
    const current=await assertJobFence(job);
    const renewed={...current,leaseUntil:new Date(Date.now()+Math.max(1000,Number(leaseMs))).toISOString()};
    return appendEventUnlocked('job.heartbeat',renewed,{id:job.id,stream:'jobs'});
  });
}
export async function completeJob(job,result){
  return withFileLock('append',async()=>{
    const current=await assertJobFence(job);
    return appendEventUnlocked('job.complete',{...current,status:'completed',result,completedAt:new Date().toISOString()},{id:job.id,stream:'jobs'});
  });
}
export async function failJob(job,error,retryAt){
  return withFileLock('append',async()=>{
    const current=await assertJobFence(job);
    const attempts=Number(current.attempts||0)+1;
    if(attempts<Number(current.maxAttempts||3)) return appendEventUnlocked('job.retry',{...current,status:'queued',attempts,runAt:retryAt||new Date(Date.now()+Math.min(60000,1000*2**Math.max(0,attempts-1))).toISOString(),lastError:String(error),leaseToken:null,workerId:null,leaseUntil:null},{id:job.id,stream:'jobs'});
    return appendEventUnlocked('job.dead',{...current,status:'dead',attempts,lastError:String(error),deadAt:new Date().toISOString(),leaseToken:null,workerId:null,leaseUntil:null},{id:job.id,stream:'jobs'});
  });
}
export async function recoverExpiredJobs(){return withFileLock('append',async()=>{const {state}=await replay();const recovered=[];const now=Date.now();for(const event of state.values()){if(event.stream!=='jobs'||!event.payload)continue;const job=event.payload;if(job.status!=='running'||!job.leaseUntil||Date.parse(job.leaseUntil)>now)continue;const recoveredJob={...job,status:'queued',workerId:null,leaseToken:null,lockedAt:null,leaseUntil:null,runAt:new Date().toISOString(),lastError:'worker lease expired; recovered locally'};await appendEventUnlocked('job.recovered',recoveredJob,{id:job.id,stream:'jobs'});recovered.push(recoveredJob);}return recovered;});}
export async function writeProject(projectId,value){const dir=path.join(PROJECT_DIR,projectId);await fs.mkdir(dir,{recursive:true,mode:0o700});const target=path.join(dir,'state.json');const temp=path.join(dir,'.state-'+process.pid+'-'+randomUUID()+'.tmp');await fs.writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await fs.rename(temp,target);return target;}
export const paths={ROOT,WAL_DIR,PROJECT_DIR,LOCK_DIR};