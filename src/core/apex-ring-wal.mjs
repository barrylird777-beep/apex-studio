import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export function createRingWal({file='/srv/apex/se-x/projects/ring-wal.jsonl',maxBytes=50*1024*1024}={}) {
  async function append(type,payload={}) {
    await fs.mkdir(path.dirname(file),{recursive:true});
    const record={id:crypto.randomUUID(),at:new Date().toISOString(),type,payload};
    const line=JSON.stringify(record)+'\n';
    await fs.appendFile(file,line,'utf8');
    const stat=await fs.stat(file);
    if(stat.size>maxBytes) await compact();
    return record;
  }
  async function readAll() {
    try { return (await fs.readFile(file,'utf8')).split('\n').filter(Boolean).map(JSON.parse); }
    catch(e){if(e.code==='ENOENT')return [];throw e;}
  }
  async function compact() {
    const records=await readAll();
    const keep=records.slice(-10000);
    const tmp=file+'.compact-'+process.pid;
    await fs.writeFile(tmp,keep.map(x=>JSON.stringify(x)).join('\n')+(keep.length?'\n':''),'utf8');
    await fs.rename(tmp,file);
    return keep.length;
  }
  return {file,append,readAll,compact};
}
