import fs from 'node:fs/promises';
import path from 'node:path';
import { createRingWal } from './apex-ring-wal.mjs';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function createAutonomousSwarmDaemon({root='/srv/apex/se-x/projects/swarm',pollMs=1000,maxBackoffMs=30000,handler=async()=>{}}={}) {
  const wal=createRingWal({file:path.join(root,'swarm-wal.jsonl')});
  let running=false; let timer=null; let failures=0; let cycleCount=0;
  async function ensure(){await fs.mkdir(root,{recursive:true});}
  async function loadQueue(){await ensure();try{return JSON.parse(await fs.readFile(path.join(root,'queue.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return [];throw e;}}
  async function saveQueue(items){await ensure();const target=path.join(root,'queue.json');const tmp=target+'.tmp-'+process.pid;await fs.writeFile(tmp,JSON.stringify(items,null,2)+'\n','utf8');await fs.rename(tmp,target);}
  async function cycle(){
    if(!running)return; cycleCount++;
    try{
      const queue=await loadQueue();
      if(queue.length){const item=queue.shift();try{await handler(item);failures=0;await saveQueue(queue);await wal.append('completed',{id:item.id??null,type:item.type??null});}catch(error){failures++;queue.push({...item,lastError:String(error?.message||error),failedAt:new Date().toISOString()});await saveQueue(queue);await wal.append('failed',{id:item.id??null,error:String(error?.message||error)});}}
      else failures=0;
    }catch(error){failures++;await wal.append('daemon-error',{error:String(error?.message||error)}).catch(()=>{});}
    if(running){const delay=Math.min(maxBackoffMs,Math.max(pollMs,pollMs*2**Math.min(failures,5)));timer=setTimeout(()=>{timer=null;void cycle();},delay);timer.unref?.();}
  }
  return {async start(){if(running)return this.status();running=true;failures=0;await cycle();return this.status();},async stop(){running=false;if(timer){clearTimeout(timer);timer=null;}return this.status();},status(){return {running,failures,cycleCount,root,pollMs,maxBackoffMs}}};
}

export async function enqueueSwarmItem({root='/srv/apex/se-x/projects/swarm',item}={}){
  if(!item||typeof item!=='object')throw new TypeError('item is required');
  await fs.mkdir(root,{recursive:true});
  const file=path.join(root,'queue.json'); let queue=[];
  try{queue=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  queue.push(item); const tmp=file+'.tmp-'+process.pid; await fs.writeFile(tmp,JSON.stringify(queue,null,2)+'\n','utf8'); await fs.rename(tmp,file); return item;
}
