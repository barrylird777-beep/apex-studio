import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { pool } from "../db/index.js";
import { claimNextWorkerTask,completeWorkerTask,failWorkerTask,heartbeatWorkerTask,enqueueWorkerTask } from "../core/mesh/durable-worker-store.mjs";
import { synthesizeSpeech,listVoiceOptions } from "../core/audio-station.mjs";
const CONCURRENCY=Math.max(1,Number(process.env.APEX_VOICEOVER_CONCURRENCY||process.env.APEX_JOB_CONCURRENCY||4));
const POLL_MS=Math.max(250,Number(process.env.APEX_VOICEOVER_POLL_MS||1000));
const OUT_DIR=process.env.APEX_VOICEOVER_DIR||path.join(process.env.STORAGE_DIR||"./data/runtime/storage","voiceover");
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let stopping=false;
async function local(text,p){return(await synthesizeSpeech({text,voice:p.voice,speed:p.speed,pitch:p.pitch,format:p.format,outputDir:OUT_DIR})).path}
async function external(text,p){
 const provider=p.provider==="auto"?String(process.env.APEX_VOICEOVER_PROVIDER||"local"):[p.provider][0];
 if(provider==="local")return local(text,p);
 const key=provider==="elevenlabs"?process.env.ELEVENLABS_API_KEY:provider==="google"?process.env.GOOGLE_TTS_API_KEY:process.env.AZURE_SPEECH_KEY;
 if(!key)throw new Error(provider+" TTS not configured");
 if(provider==="elevenlabs"){const voice=p.voice||process.env.ELEVENLABS_VOICE_ID;if(!voice)throw new Error("ElevenLabs voice_id required");const r=await fetch("https://api.elevenlabs.io/v1/text-to-speech/"+encodeURIComponent(voice),{method:"POST",headers:{"xi-api-key":key,"content-type":"application/json"},body:JSON.stringify({text,model_id:p.model||"eleven_multilingual_v2"})});if(!r.ok)throw new Error("ElevenLabs "+r.status);const b=Buffer.from(await r.arrayBuffer()),f=path.join(OUT_DIR,p.id+".mp3");await fs.mkdir(OUT_DIR,{recursive:true});await fs.writeFile(f,b);return f}
 if(provider==="google"){const voice=p.voice||process.env.GOOGLE_TTS_VOICE||"en-US-Neural2-D";const r=await fetch("https://texttospeech.googleapis.com/v1/text:synthesize?key="+encodeURIComponent(key),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({input:{text},voice:{languageCode:p.language||"en-US",name:voice},audioConfig:{audioEncoding:"MP3"}})});if(!r.ok)throw new Error("Google TTS "+r.status);const d=await r.json(),b=Buffer.from(d.audioContent||"","base64"),f=path.join(OUT_DIR,p.id+".mp3");await fs.mkdir(OUT_DIR,{recursive:true});await fs.writeFile(f,b);return f}
 throw new Error("Unsupported voiceover provider: "+provider);
}
export async function enqueueVoiceoverJob(input={},options={}){
 const id=options.id||input.id||crypto.randomUUID();
 await enqueueWorkerTask({id,workerId:"voiceover-producer",role:"voiceover",task:"VOICEOVER_SYNTHESIS",payload:{id,text:String(input.text||""),provider:String(input.provider||"auto"),voice:input.voice||"",language:input.language||"en-US",speed:Number(input.speed||1),pitch:Number(input.pitch||0),format:String(input.format||"wav"),model:input.model||null,sceneId:input.sceneId==null?null:Number(input.sceneId),projectId:input.projectId==null?null:Number(input.projectId)},maxAttempts:Number(options.maxAttempts||process.env.APEX_VOICEOVER_MAX_ATTEMPTS||3)});
 return id;
}
async function processTask(task){
 const p={...task.payload,id:task.id},hb=setInterval(()=>heartbeatWorkerTask(task.id,120000,task.lease_token).catch(()=>{}),30000);
 try{const file=await external(p.text,p),hash=crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex");await completeWorkerTask(task.id,{file,contentHash:hash},task.lease_token)}
 catch(e){await failWorkerTask(task.id,e,task.lease_token)}
 finally{clearInterval(hb)}
}
export async function startVoiceoverWorker(){const loop=async()=>{while(!stopping){const t=await claimNextWorkerTask(120000,"VOICEOVER_SYNTHESIS");if(!t){await sleep(POLL_MS);continue}await processTask(t)}};await Promise.all(Array.from({length:CONCURRENCY},loop))}
export async function listVoiceCatalog(){return(await listVoiceOptions()).map(v=>({...v,provider:"local"}))}
export async function voiceoverWorkerStatus(){const r=await pool.query("SELECT COUNT(*) FILTER(WHERE status='queued')::int queued,COUNT(*) FILTER(WHERE status='running')::int running FROM apex_worker_tasks WHERE task='VOICEOVER_SYNTHESIS'");return{concurrency:CONCURRENCY,queued:r.rows[0]?.queued||0,running:r.rows[0]?.running||0}}
for(const s of ["SIGINT","SIGTERM"])process.once(s,()=>{stopping=true});
if(process.argv[1]&&new URL(import.meta.url).pathname===new URL(process.argv[1],"file:").pathname)await startVoiceoverWorker();
