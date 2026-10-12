import { mkdir, open, readFile, unlink, stat, lstat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
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
  constructor({file=FILE,ringSize=RING_SIZE,lockTimeoutMs=65000,staleLockMs=60000,maxBytes=Number(process.env.APEX_WAL_MAX_BYTES||50*1024*1024)}={}){
    this.file=path.resolve(file);this.maxBytes=Number(maxBytes);if(!Number.isSafeInteger(this.maxBytes)||this.maxBytes<=0)throw new TypeError("maxBytes must be a positive safe integer");this.lockFile=this.file+".lock";this.ringSize=ringSize;this.lockTimeoutMs=lockTimeoutMs;this.staleLockMs=staleLockMs;
    this.seq=0;this.lastHash="0".repeat(64);this.ring=new Array(ringSize);this.head=0;this.count=0;this.offset=0;this.lastExternalRecords=[];this.ready=false;
  }
  _reset(){this.seq=0;this.lastHash="0".repeat(64);this.ring=new Array(this.ringSize);this.head=0;this.count=0;this.offset=0;}
  _load(record){this.seq=Number(record.seq);this.lastHash=String(record.hash);this.ring[this.head]=record;this.head=(this.head+1)%this.ringSize;this.count=Math.min(this.count+1,this.ringSize);}
  async _assertWalIsRegular(){
    try{const info=await lstat(this.file);if(info.isSymbolicLink()||!info.isFile())throw new Error("[SECURITY_VIOLATION] WAL path must be a regular file, not a symlink.");}
    catch(e){if(e.code!=="ENOENT")throw e;}
  }
  async _streamRecords(onRecord=async()=>{}){
    await this._assertWalIsRegular();
    this._reset();
    let info;
    try{info=await stat(this.file);}catch(e){if(e.code==="ENOENT"){this.offset=0;return 0;}throw e;}
    if(info.size>0){
      const fh=await open(this.file,"r");
      try{
        const last=Buffer.alloc(1);
        const {bytesRead}=await fh.read(last,0,1,info.size-1);
        if(bytesRead!==1||last[0]!==10)throw new Error("[WAL_INTEGRITY] Incomplete final WAL record; preserved for inspection.");
      }finally{await fh.close();}
    }
    let prev="0".repeat(64),seq=0,count=0;
    const input=createReadStream(this.file,{encoding:"utf8"});
    const lines=createInterface({input,crlfDelay:Infinity});
    try{
      for await(const line of lines){
        if(!line)continue;
        let record;
        try{record=JSON.parse(line);}catch(e){throw new Error("[WAL_INTEGRITY] Invalid JSON at sequence "+(seq+1)+": "+e.message);}
        if(!record||!Number.isSafeInteger(record.seq)||record.seq!==seq+1||record.prevHash!==prev||record.hash!==expectedHash(record)){
          throw new Error("[WAL_INTEGRITY] Hash chain or sequence failure at record "+(seq+1)+".");
        }
        this._load(record);prev=record.hash;seq=record.seq;count++;
        await onRecord(record);
      }
    }catch(error){input.destroy();throw error;}
    this.offset=info.size;
    return count;
  }
  async _readAndVerify(){return this._streamRecords();}
  async _acquireLock(){
    const started=Date.now();
    let fh,token;
    while(true){
      try{
        token=randomUUID();
        fh=await open(this.lockFile,"wx",0o600);
        await fh.writeFile(JSON.stringify({pid:process.pid,host:os.hostname(),createdAt:Date.now(),token})+"\n","utf8");
        await fh.sync();
        break;
      }catch(e){
        if(fh){await fh.close().catch(()=>{});fh=undefined;}
        if(e.code!=="EEXIST")throw e;
        let stale=false;
        try{const info=await stat(this.lockFile);stale=Date.now()-info.mtimeMs>Math.max(120000,this.staleLockMs*2);}catch(err){if(err.code==="ENOENT")continue;throw err;}
        if(stale){
          const quarantine=this.lockFile+".stale."+randomUUID();
          try{await (await import("node:fs/promises")).rename(this.lockFile,quarantine);await unlink(quarantine).catch(err=>{if(err.code!=="ENOENT")throw err;});}
          catch(err){if(err.code!=="ENOENT"&&err.code!=="EEXIST")throw err;}
          continue;
        }
        if(Date.now()-started>=Math.max(180000,this.lockTimeoutMs*2))throw new Error("[WAL_LOCK] Timed out waiting for the cross-process WAL lock.");
        await sleep(20+Math.floor(Math.random()*31));
      }
    }
    const heartbeat=setInterval(()=>{const now=new Date();fh?.utimes(now,now).catch(()=>{});},10000);
    heartbeat.unref?.();
    return async()=>{
      clearInterval(heartbeat);
      const owned=fh;fh=undefined;
      let ownsPath=false;
      try{
        const [opened,current,contents]=await Promise.all([owned.stat(),stat(this.lockFile),readFile(this.lockFile,"utf8")]);
        ownsPath=opened.dev===current.dev&&opened.ino===current.ino&&JSON.parse(contents).token===token;
      }catch(err){if(err.code!=="ENOENT"&&!(err instanceof SyntaxError))throw err;}
      await owned.close().catch(()=>{});
      if(ownsPath){await unlink(this.lockFile).catch(err=>{if(err.code!=="ENOENT")throw err;});await syncDirectory(path.dirname(this.file));}
    };
  }
  async _refreshLocked(onRecord=()=>{}){
    this.lastExternalRecords=[];
    await this._assertWalIsRegular();
    let size=0;
    try{size=(await stat(this.file)).size;}catch(e){if(e.code==="ENOENT"&&this.offset===0)return 0;throw e;}
    if(size<this.offset)throw new Error("[WAL_INTEGRITY] WAL was truncated after initialization.");
    if(size===this.offset)return 0;
    const fh=await open(this.file,"r");
    let text="";
    try{
      const buffer=Buffer.alloc(size-this.offset);
      const {bytesRead}=await fh.read(buffer,0,buffer.length,this.offset);
      if(bytesRead!==buffer.length)throw new Error("[WAL_INTEGRITY] WAL changed while reading appended records.");
      text=buffer.toString("utf8");
    }finally{await fh.close();}
    if(!text.endsWith("\n"))throw new Error("[WAL_INTEGRITY] Incomplete final WAL record; preserved for inspection.");
    let prev=this.lastHash,seq=this.seq,count=0;
    for(const line of text.split("\n").filter(Boolean)){
      let record;
      try{record=JSON.parse(line);}catch(e){throw new Error("[WAL_INTEGRITY] Invalid appended JSON: "+e.message);}
      if(!record||!Number.isSafeInteger(record.seq)||record.seq!==seq+1||record.prevHash!==prev||record.hash!==expectedHash(record)){
        throw new Error("[WAL_INTEGRITY] Appended hash chain or sequence failure at record "+(seq+1)+".");
      }
      this._load(record);prev=record.hash;seq=record.seq;count++;this.lastExternalRecords.push(record);await onRecord(record);
    }
    this.offset=size;
    return count;
  }
  async init(){
    if(this.ready)return this;
    await mkdir(path.dirname(this.file),{recursive:true,mode:0o700});
    const release=await this._acquireLock();
    try{await this._readAndVerify();this.ready=true;return this;}finally{await release();}
  }
  async append(type,payload={},meta={}){
    await this.init();
    const run=async()=>{
      const release=await this._acquireLock();
      try{
        await this._refreshLocked();
        const record={version:1,id:randomUUID(),seq:this.seq+1,ts:new Date().toISOString(),type:String(type),payload,meta,prevHash:this.lastHash};
        record.hash=sha(record);
        const line=JSON.stringify(record)+"\n";
        const incomingBytes=Buffer.byteLength(line,"utf8");
        if(this.offset+incomingBytes>this.maxBytes){const error=new Error(`WAL_CAPACITY_EXCEEDED: ${this.offset}+${incomingBytes} exceeds ${this.maxBytes} bytes`);error.code="WAL_CAPACITY_EXCEEDED";error.currentBytes=this.offset;error.incomingBytes=incomingBytes;error.maxBytes=this.maxBytes;throw error;}
        const fh=await open(this.file,"a",0o600);
        try{await fh.writeFile(line,"utf8");await fh.sync();}finally{await fh.close();}
        await syncDirectory(path.dirname(this.file));
        this._load(record);this.offset+=Buffer.byteLength(line,"utf8");
        Object.defineProperty(record,"externalRecords",{value:this.lastExternalRecords.slice(),enumerable:false});
        return record;
      }finally{await release();}
    };
    const next=chain.then(run,run);chain=next.catch(()=>{});return next;
  }
  async refresh({onRecord=()=>{}}={}){
    await this.init();
    const release=await this._acquireLock();
    try{return await this._refreshLocked(onRecord);}finally{await release();}
  }
  async replay({onRecord=async()=>{}}={}){
    await mkdir(path.dirname(this.file),{recursive:true,mode:0o700});
    const release=await this._acquireLock();
    try{const count=await this._streamRecords(onRecord);this.ready=true;return count;}finally{await release();}
  }
  async snapshot(){await this.init();await this.refresh();return {file:this.file,sequence:this.seq,head:this.head,count:this.count,lastHash:this.lastHash,ring:this.ring.filter(Boolean)};}
}
export const apexRingWAL=new ApexRingWAL();

/** Compatibility facade: the complete hash chain is retained; compact never truncates it. */
export function createRingWal({file=FILE,maxBytes=50*1024*1024}={}){
  const wal=new ApexRingWAL({file,maxBytes});
  async function append(type,payload={}){const record=await wal.append(type,payload);return {...record,at:record.ts};}
  async function readAll(){const records=[];await wal.replay({onRecord:record=>{records.push({...record,at:record.ts});}});return records;}
  async function compact(){return (await readAll()).length;}
  return {file,append,readAll,compact,maxBytes};
}
