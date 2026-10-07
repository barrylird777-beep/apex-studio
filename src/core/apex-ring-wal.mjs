import { appendFile, mkdir, open, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const ROOT = process.env.APEX_SE_X_ROOT || "/srv/apex/se-x";
const WAL_DIR = process.env.APEX_WAL_DIR || path.join(ROOT, "wal");
const SEGMENT_BYTES = Math.max(1024 * 1024, Number(process.env.APEX_WAL_SEGMENT_BYTES || 64 * 1024 * 1024));
const QUEUE_LIMIT = Math.max(1024, Number(process.env.APEX_RING_QUEUE || 65536));

export class ApexRingWAL {
  constructor({ dir = WAL_DIR, segmentBytes = SEGMENT_BYTES, queueLimit = QUEUE_LIMIT } = {}) {
    this.dir = path.resolve(dir); this.segmentBytes = segmentBytes; this.queueLimit = queueLimit;
    this.queue = []; this.flushing = null; this.sequence = 0; this.segment = 0; this.bytes = 0; this.closed = false; this.ready = false;
  }
  async init() {
    if (this.ready) return this;
    await mkdir(this.dir, { recursive: true });
    try { const m = JSON.parse(await readFile(path.join(this.dir, "ring.meta.json"), "utf8")); this.sequence=Number(m.sequence||0); this.segment=Number(m.segment||0); this.bytes=Number(m.bytes||0); } catch {}
    this.ready = true; return this;
  }
  segmentPath(n=this.segment) { return path.join(this.dir, "segment-"+String(n).padStart(12,"0")+".jsonl"); }
  async persistMeta() {
    const file=path.join(this.dir,"ring.meta.json"); const tmp=file+"."+process.pid+"."+randomUUID()+".tmp";
    await appendFile(tmp, JSON.stringify({sequence:this.sequence,segment:this.segment,bytes:this.bytes})+"\n","utf8"); await rename(tmp,file);
  }
  async append(type,payload={},meta={}) {
    if(this.closed) throw new Error("ApexRingWAL is closed"); await this.init();
    return new Promise((resolve,reject)=>{ if(this.queue.length>=this.queueLimit)return reject(new Error("Apex Ring-WAL queue saturated")); this.queue.push({type,payload,meta,resolve,reject}); void this.flush(); });
  }
  async flush() {
    if(this.flushing)return this.flushing;
    this.flushing=(async()=>{ while(this.queue.length){
      const item=this.queue.shift(); const record={v:1,seq:++this.sequence,ts:new Date().toISOString(),type:String(item.type),payload:item.payload??{},meta:item.meta??{}};
      const line=JSON.stringify(record)+"\n"; const size=Buffer.byteLength(line); if(this.bytes&&this.bytes+size>this.segmentBytes){this.segment++;this.bytes=0;}
      const fh=await open(this.segmentPath(),"a"); try{await fh.write(line,null,"utf8");await fh.sync();}finally{await fh.close();}
      this.bytes+=size; await this.persistMeta(); item.resolve(record);
    }})().finally(()=>{this.flushing=null;}); return this.flushing;
  }
  async replay({from=0,to=Infinity,onRecord}={}) {
    await this.init(); let last=Number(from)||0;
    for(let n=0;n<=this.segment;n++){let text;try{text=await readFile(this.segmentPath(n),"utf8")}catch{continue} for(const line of text.split("\n")){if(!line.trim())continue;let record;try{record=JSON.parse(line)}catch{continue}if(record.seq<=last||record.seq>to)continue;await onRecord?.(record);last=record.seq;}}
    return last;
  }
  async close(){await this.flush();this.closed=true;}
}
export const apexRingWAL=new ApexRingWAL();