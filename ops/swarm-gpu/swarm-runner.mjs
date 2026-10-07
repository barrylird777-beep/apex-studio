import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const BASE=(process.env.SWARM_BASE_URL||'http://127.0.0.1:8000/v1').replace(/\/$/,'');
const KEY=process.env.SWARM_API_KEY||'local';
const MODEL=process.env.SWARM_MODEL;
const ROOT=process.env.SWARM_ROOT||'/srv/apex/se-x/projects/swarm';
const CONCURRENCY=Math.max(1,Number(process.env.SWARM_CONCURRENCY||6));
const RETRIES=Math.max(0,Number(process.env.SWARM_MAX_RETRIES||4));

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const delay=n=>Math.min(30000,1000*(2**n))+Math.floor(Math.random()*500);
const safe=p=>{if(typeof p!=='string'||!p||path.isAbsolute(p)||p.includes('\0'))throw new Error('unsafe path');const n=path.normalize(p);if(n==='..'||n.startsWith('../'))throw new Error('path traversal');return n;};

async function request(task){
 if(!MODEL)throw new Error('SWARM_MODEL is required');
 const r=await fetch(BASE+'/chat/completions',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+KEY},body:JSON.stringify({model:MODEL,temperature:0,max_tokens:32768,messages:[{role:'user',content:'Return only JSON with files [{path,content}] and summary. Implement this Apex surface in the existing repository without inventing credentials or claiming tests you did not run. Surface: '+task.id+'. Goal: '+task.goal} ]})});
 if(!r.ok)throw new Error('model HTTP '+r.status);
 const b=await r.json();
 const c=b?.choices?.[0]?.message?.content;
 if(!c)throw new Error('empty model response');
 return JSON.parse(c.replace(/^\s*\`\`\`json\s*/,'').replace(/\s*\`\`\`\s*$/,''));
}

async function stage(task,result){
 const dir=path.join(ROOT,'staging',task.id+'-'+crypto.randomUUID());
 await fs.mkdir(dir,{recursive:true});
 for(const f of result.files||[]){const rel=safe(f.path);const target=path.join(dir,rel);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,String(f.content??''),'utf8');}
 await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify({task,result,createdAt:new Date().toISOString()},null,2)+'\n');
 return dir;
}

async function worker(task){
 let last;
 for(let n=0;n<=RETRIES;n++){try{const result=await request(task);return {id:task.id,status:'staged',stageDir:await stage(task,result)};}catch(e){last=e;if(n<RETRIES)await sleep(delay(n));}}
 return {id:task.id,status:'failed',error:String(last?.message||last)};
}

const manifest=JSON.parse(await fs.readFile(new URL('./swarm-manifest.json',import.meta.url),'utf8'));
await fs.mkdir(ROOT,{recursive:true});
const queue=[...manifest.surfaces];let cursor=0;const results=[];
async function lane(){while(true){const i=cursor++;if(i>=queue.length)return;results.push(await worker(queue[i]));}}
await Promise.all(Array.from({length:Math.min(CONCURRENCY,queue.length)},lane));
const report=path.join(ROOT,'swarm-report.json');
await fs.writeFile(report,JSON.stringify({at:new Date().toISOString(),results},null,2)+'\n');
process.stdout.write(JSON.stringify({report,results},null,2)+'\n');
