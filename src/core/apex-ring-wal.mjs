import { mkdir, open, readFile, unlink, stat, lstat } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";

const ROOT=process.env.APEX_SE_X_ROOT||"/srv/apex/se-x";
const WAL_DIR=process.env.APEX_WAL_DIR||path.join(ROOT,"wal");
const FILE=process.env.APEX_WAL_FILE||path.join(WAL_DIR,"ring.wal.jsonl");
const RING_SIZE=Math.max(1024,Number(process.env.APEX_RING_SIZE||65536));
let chain=Promise.resolve();

const sha=v=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function syncDirectory(dir){const fh=await open(dir,"r");try{await fh.sync();}finally{await fh.close();}}
function expectedHash(record){const {hash,...body}=record;return sha(body);}

export class ApexRingWAL {
  constructor({file=FILE,ringSize=RING_SIZE,lockTimeoutMs=65000,staleLockMs=60000}={}){
    this.file=path.resolve(file);this.lockFile=this.file+".lock";this.ringSize=ringSize;this.lockTimeoutMs=lockTimeoutMs;this.staleLockMs=staleLockMs;
    this.seq=0;this.lastHash="0".repeat(64);this.ring=new Array(ringSize);this.head=0;this.count=0;this.ready=false;
  }
  _reset(){this.seq=0;this.lastHash="0".repeat(64);this.ring=new Array(this.ringSize);this.head=0;this.count=0;}
  _load(record){this.seq=Number(record.seq);this.lastHash=String(record.hash);this.ring[this.head]=record;this.head=(this.head+1)%this.ringSize;this.count=Math.min(this.count+1,this.ringSize);}
  async _assertWalIsRegular(){
    try{const info=await lstat(this.file);if(info.isSymbolicLink()||!info.isFile())throw new Error("[SECURITY_VIOLATION] WAL path must be a regular file, not a symlink.");}
    catch(e){if(e.code!=="ENOENT")throw e;}
  }
  async _readAndVerify(){
    await this._assertWalIsRegular();
    this._reset();
    let text="";
    try{text=await readFile(this.file,"utf8");}catch(e){if(e.code==="ENOENT")return 0;throw e;}
    if(text.length&&!text.endsWith("\n"))throw new Error("[WAL_INTEGRITY] Incomplete final WAL record; preserved for inspection.");
    let prev="0".repeat(64),seq=0,count=0;
    for(const line of text.split("\n").filter(Boolean)){
      let record;
      try{record=JSON.parse(line);}catch(e){throw new Error("[WAL_INTEGRITY] Invalid JSON at sequence "+(seq+1)+": "+e.message);}
      if(!record||!Number.isSafeInteger(record.seq)||record.seq!==seq+1||record.prevHash!==prev||record.hash!==expectedHash(record)){
        throw new Error("[WAL_INTEGRITY] Hash chain or sequence failure at record "+(seq+1)+".");
      }
      this._load(record);prev=record.hash;seq=record.seq;count++;
    }
    return count;
  }
  async init(){
    if(this.ready)return this;
    await mkdir(path.dirname(this.file),{recursive:true,mode:0o700});
    const release=await this._acquireLock();
    try{await this._assertWalIsRegular();await this._readAndVerify();this.ready=true;return this;}finally{await release();}
  }
  async _acquireLock(){
    const started=Date.now();
    while(true){
      try{
        const fh=await open(this.lockFile,"wx",0o600);
        try{await fh.writeFile(JSON.stringify({pid:process.pid,host:os.hostname(),createdAt:Date.now()})+"\n","utf8");await fh.sync();}
        catch(e){await fh.close().catch(()=>{});await unlink(this.lockFile).catch(()=>{});throw e;}
        await fh.close();
        return async()=>{await unlink(this.lockFile).catch(e=>{if(e.code!=="ENOENT")throw e;});await syncDirectory(path.dirname(this.file));};
      }catch(e){
        if(e.code!=="EEXIST")throw e;
        let stale=false;
        try{const info=await stat(this.lockFile);stale=Date.now()-info.mtimeMs>this.staleLockMs;}catch(err){if(err.code==="ENOENT")continue;throw err;}
        if(stale){await unlink(this.lockFile).catch(err=>{if(err.code!=="ENOENT")throw err;});continue;}
        if(Date.now()-started>=this.lockTimeoutMs)throw new Error("[WAL_LOCK] Timed out waiting for the cross-process WAL lock.");
        await sleep(20+Math.floor(Math.random()*31));
      }
    }
  }
  async append(type,payload={},meta={}){
    await this.init();
    const run=async()=>{
      const release=await this._acquireLock();
      try{
        // Re-read and verify under the file lock so independent app/server/worker
        // processes cannot append duplicate sequence numbers or stale hash links.
        await this._readAndVerify();
        const record={version:1,id:randomUUID(),seq:this.seq+1,ts:new Date().toISOString(),type:String(type),payload,meta,prevHash:this.lastHash};
        record.hash=sha(record);
        const fh=await open(this.file,"a",0o600);
        try{await fh.writeFile(JSON.stringify(record)+"\n","utf8");await fh.sync();}finally{await fh.close();}
        await syncDirectory(path.dirname(this.file));
        this._load(record);
        return record;
      }finally{await release();}
    };
    const next=chain.then(run,run);chain=next.catch(()=>{});return next;
  }
  async replay({onRecord=()=>{}}={}){
    await this.init();
    // Validate the complete file before exposing any record to a state reducer.
    const count=await this._readAndVerify();
    let text="";
    try{text=await readFile(this.file,"utf8");}catch(e){if(e.code==="ENOENT")return 0;throw e;}
    for(const line of text.split("\n").filter(Boolean))await onRecord(JSON.parse(line));
    return count;
  }
  async snapshot(){await this.init();return {file:this.file,sequence:this.seq,head:this.head,count:this.count,lastHash:this.lastHash,ring:this.ring.filter(Boolean)};}
}
export const apexRingWAL=new ApexRingWAL();

/**
 * Compatibility facade for legacy callers.
 * The full hash chain is retained; compact never truncates recovery history.
 */
export function createRingWal({file=FILE,maxBytes=50*1024*1024}={}){
  const wal=new ApexRingWAL({file});
  async function append(type,payload={}){const record=await wal.append(type,payload);return {...record,at:record.ts};}
  async function readAll(){const records=[];await wal.replay({onRecord:record=>{records.push({...record,at:record.ts});}});return records;}
  async function compact(){return (await readAll()).length;}
  return {file,append,readAll,compact,maxBytes};
}
