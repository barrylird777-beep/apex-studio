import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const ROOT=process.env.APEX_SE_X_ROOT||"/srv/apex/se-x";
const WAL_DIR=process.env.APEX_WAL_DIR||path.join(ROOT,"wal");
const FILE=process.env.APEX_WAL_FILE||path.join(WAL_DIR,"ring.wal.jsonl");
const RING_SIZE=Math.max(1024,Number(process.env.APEX_RING_SIZE||65536));
const chains=new Map();
const sha=v=>createHash("sha256").update(JSON.stringify(v)).digest("hex");

export class ApexRingWAL {
  constructor({file=FILE,ringSize=RING_SIZE}={}){
    this.file=file;this.ringSize=ringSize;this.seq=0;this.lastHash="0".repeat(64);
    this.ring=new Array(ringSize);this.head=0;this.count=0;this.ready=false;
  }
  async init(){
    if(this.ready)return this;
    await mkdir(path.dirname(this.file),{recursive:true});
    try{
      const text=await readFile(this.file,"utf8"),lines=text.split("\n").filter(Boolean);
      this.seq=0;this.lastHash="0".repeat(64);this.head=0;this.count=0;
      for(const line of lines) this._load(JSON.parse(line));
    }catch(e){if(e.code!=="ENOENT")throw e;}
    this.ready=true;return this;
  }
  _load(record){
    this.seq=Math.max(this.seq,Number(record.seq)||0);this.lastHash=String(record.hash||this.lastHash);
    this.ring[this.head]=record;this.head=(this.head+1)%this.ringSize;this.count=Math.min(this.count+1,this.ringSize);
  }
  async append(type,payload={},meta={}){
    await this.init();
    const key=path.resolve(this.file),prior=chains.get(key)||Promise.resolve();
    const run=prior.then(async()=>{
      const record={version:1,id:randomUUID(),seq:this.seq+1,ts:new Date().toISOString(),type:String(type),payload,meta,prevHash:this.lastHash};
      record.hash=sha(record);
      const fh=await open(this.file,"a");
      try{await fh.writeFile(JSON.stringify(record)+"\n","utf8");await fh.sync();}
      finally{await fh.close();}
      this._load(record);return record;
    });
    chains.set(key,run.catch(()=>{}));return run;
  }
  async replay({onRecord=()=>{}}={}){
    await this.init();let prev="0".repeat(64),seq=0,count=0,text="";
    try{text=await readFile(this.file,"utf8");}catch(e){if(e.code==="ENOENT")return 0;throw e;}
    for(const line of text.split("\n").filter(Boolean)){
      const r=JSON.parse(line),expected=sha({...r,hash:undefined});
      if(r.prevHash!==prev||r.hash!==expected||Number(r.seq)!==seq+1)throw new Error("WAL integrity failure at sequence "+r.seq);
      await onRecord(r);prev=r.hash;seq=r.seq;count++;
    }
    return count;
  }
  async snapshot(){await this.init();return{file:this.file,sequence:this.seq,head:this.head,count:this.count,lastHash:this.lastHash,ring:this.ring.filter(Boolean)};}
}
export const apexRingWAL=new ApexRingWAL();
