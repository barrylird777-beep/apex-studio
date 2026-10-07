import fs from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve(process.env.STORAGE_DIR||'/srv/apex/se-x/projects');

export async function listRapidProofs(limit=8){
  const entries=await fs.readdir(root,{withFileTypes:true}).catch(()=>[]);
  const files=[];
  for(const entry of entries){
    if(!entry.isFile()||!/^rapid_order_[A-Za-z0-9_-]+\.mp4$/.test(entry.name)) continue;
    const stat=await fs.stat(path.join(root,entry.name)).catch(()=>null);
    if(stat) files.push({name:entry.name,mtimeMs:stat.mtimeMs,size:stat.size});
  }
  files.sort((a,b)=>b.mtimeMs-a.mtimeMs);
  return files.slice(0,Math.max(1,Math.min(24,Number(limit)||8))).map(file=>({
    orderId:file.name.slice(12,-4),
    url:'/files/'+encodeURIComponent(file.name),
    generatedAt:new Date(file.mtimeMs).toISOString(),
    ageSeconds:Math.max(0,Math.floor((Date.now()-file.mtimeMs)/1000)),
    bytes:file.size
  }));
}
