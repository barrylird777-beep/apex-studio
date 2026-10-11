import { appendFile, mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const ROOT=process.env.APEX_SE_X_ROOT||"/srv/apex/se-x";
const WAL_DIR=process.env.APEX_WAL_DIR||path.join(ROOT,"wal");
const FILE=process.env.APEX_WAL_FILE||path.join(WAL_DIR,"ring.wal.jsonl");
const RING_SIZE=Math.max(1024,Number(process.env.APEX_RING_SIZE||65536));
let chain=Promise.resolve();

const sha=v=>createHash("sha256").update(JSON.stringify(v)).digest("hex");

export class ApexRingWAL {
  constructor({file=FILE,ringSize=RING_SIZE}={}){this.file=file;this.ringSize=ringSize;this.seq=0;this.lastHash="0".repeat(64);this.ring=new Array(ringSize);this.head=0;this.count=0;this.ready=false;}
  async init(){
    if(this.ready)return this;
    await mkdir(path.dirname(this.file),{recursive:true});
    try{const text=await readFile(this.file,"utf8");const lines=text.split("\n").filter(Boolean);for(const line of lines.slice(-this.ringSize))this._load(JSON.parse(line));}catch(e){if(e.code!=="ENOENT")throw e;}
    this.ready=true;return this;
  }
  _load(record){this.seq=Math.max(this.seq,Number(record.seq)||0);this.lastHash=String(record.hash||this.lastHash);this.ring[this.head]=record;this.head=(this.head+1)%this.ringSize;this.count=Math.min(this.count+1,this.ringSize);}
  async append(type,payload={},meta={}){
    await this.init();
    const run=async()=>{
      const record={version:1,id:randomUUID(),seq:this.seq+1,ts:new Date().toISOString(),type:String(type),payload,meta,prevHash:this.lastHash};
      record.hash=sha(record);
      const fh=await open(this.file,"a");try{await fh.writeFile(JSON.stringify(record)+"\n","utf8");await fh.sync();}finally{await fh.close();}
      this._load(record);return record;
    };
    const next=chain.then(run,run);chain=next.catch(()=>{});return next;
  }
  async replay({onRecord=()=>{}}={}){
    await this.init();let prev="0".repeat(64),seq=0;
    let text="";try{text=await readFile(this.file,"utf8");}catch(e){if(e.code==="ENOENT")return 0;throw e;}
    let count=0;for(const line of text.split("\n").filter(Boolean)){
      const r=JSON.parse(line);const expected=sha({...r,hash:undefined});if(r.prevHash!==prev||r.hash!==expected||Number(r.seq)!==seq+1)throw new Error("WAL integrity failure at sequence "+r.seq);await onRecord(r);prev=r.hash;seq=r.seq;count++;
    }return count;
  }
  async snapshot(){await this.init();return {file:this.file,sequence:this.seq,head:this.head,count:this.count,lastHash:this.lastHash,ring:this.ring.filter(Boolean)};}
}
export const apexRingWAL=new ApexRingWAL();

/**
 * Compatibility facade for legacy callers. The underlying log remains
 * hash-chained and fsync-backed; readAll replays the complete retained log.
 */
export function createRingWal({ file = FILE, maxBytes = 50 * 1024 * 1024 } = {}) {
  const wal = new ApexRingWAL({ file });
  async function append(type, payload = {}) {
    const record = await wal.append(type, payload);
    return { ...record, at: record.ts };
  }
  async function readAll() {
    const records = [];
    await wal.replay({ onRecord: record => { records.push({ ...record, at: record.ts }); } });
    return records;
  }
  async function compact() {
    const records = await readAll();
    // Truncating a hash chain would invalidate its next-record integrity proof.
    // Preserve the complete log rather than silently destroying recovery history.
    return records.length;
  }
  return { file, append, readAll, compact, maxBytes };
}
