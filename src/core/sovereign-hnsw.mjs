import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { paths } from './sovereign-local-storage.mjs';

const INDEX_DIR = process.env.APEX_HNSW_DIR || path.join(paths.PROJECT_DIR, '.hnsw');
const M = Math.max(4, Number(process.env.APEX_HNSW_M || 16));
const EF = Math.max(M, Number(process.env.APEX_HNSW_EF || 64));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function lock(name) {
  await fs.mkdir(INDEX_DIR, { recursive: true, mode: 0o700 });
  const p = path.join(INDEX_DIR, '.' + name + '.lock');
  for (;;) {
    try { const h = await fs.open(p, 'wx', 0o600); return { h, p }; }
    catch (e) { if (e.code !== 'EEXIST') throw e; await sleep(10); }
  }
}
async function unlock(l) { await l.h.close().catch(() => {}); await fs.unlink(l.p).catch(() => {}); }
const dot = (a,b) => { let s=0, aa=0, bb=0; for(let i=0;i<a.length;i++){s+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];} return aa&&bb?s/Math.sqrt(aa*bb):0; };
const levelFor = () => Math.max(0, Math.floor(-Math.log(Math.random()) * (1 / Math.log(M))));
const fileFor = name => path.join(INDEX_DIR, name + '.json');

export class HNSWIndex {
  constructor(name = 'apex') { this.name=name; this.file=fileFor(name); this.nodes=new Map(); this.entry=null; this.maxLevel=-1; this.loaded=false; }
  async load() {
    if (this.loaded) return this;
    await fs.mkdir(INDEX_DIR, { recursive:true, mode:0o700 });
    try { const data=JSON.parse(await fs.readFile(this.file,'utf8')); this.entry=data.entry ?? null; this.maxLevel=Number(data.maxLevel ?? -1); for(const node of data.nodes ?? []) this.nodes.set(node.id,node); }
    catch(e) { if(e.code !== 'ENOENT') throw e; }
    this.loaded=true; return this;
  }
  async persist() {
    const temp=this.file+'.'+process.pid+'.'+randomUUID()+'.tmp';
    const body=JSON.stringify({format:'apex-hnsw-v1',M,efConstruction:EF,entry:this.entry,maxLevel:this.maxLevel,nodes:[...this.nodes.values()]});
    await fs.writeFile(temp,body,{mode:0o600}); await fs.rename(temp,this.file);
  }
  async add(id, vector, metadata={}) {
    await this.load();
    if(!Array.isArray(vector)||!vector.length||vector.some(x=>!Number.isFinite(x))) throw new TypeError('vector must be a finite numeric array');
    const l=await lock(this.name);
    try {
      await this.load();
      const level=levelFor(); const node={id,vector:vector.map(Number),metadata,level,links:[]};
      if(!this.nodes.size){this.nodes.set(id,node);this.entry=id;this.maxLevel=level;await this.persist();return node;}
      const candidates=[...this.nodes.values()].filter(x=>x.id!==id).sort((a,b)=>dot(b.vector,node.vector)-dot(a.vector,node.vector)).slice(0,EF);
      node.links=candidates.slice(0,M).map(x=>x.id); this.nodes.set(id,node);
      for(const peer of candidates.slice(0,M)){const p=this.nodes.get(peer.id);p.links=[...new Set([...(p.links||[]),id])].sort((a,b)=>dot(this.nodes.get(b).vector,p.vector)-dot(this.nodes.get(a).vector,p.vector)).slice(0,M);}
      if(level>this.maxLevel){this.maxLevel=level;this.entry=id;} await this.persist(); return node;
    } finally { await unlock(l); }
  }
  async search(vector,k=10) {
    await this.load(); const scored=[]; const seen=new Set(); const queue=this.entry?[this.entry]:[];
    while(queue.length&&seen.size<EF){const id=queue.shift();if(seen.has(id))continue;seen.add(id);const node=this.nodes.get(id);if(!node)continue;scored.push({id:node.id,score:dot(node.vector,vector),metadata:node.metadata});for(const next of node.links||[])if(!seen.has(next))queue.push(next);queue.sort((a,b)=>dot(this.nodes.get(b)?.vector||[],vector)-dot(this.nodes.get(a)?.vector||[],vector));}
    if(seen.size<this.nodes.size)for(const node of this.nodes.values())if(!seen.has(node.id))scored.push({id:node.id,score:dot(node.vector,vector),metadata:node.metadata});
    return scored.sort((a,b)=>b.score-a.score).slice(0,Math.max(1,k));
  }
}
export default HNSWIndex;