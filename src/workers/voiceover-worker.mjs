import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { synthesizeSpeech, listVoiceOptions } from "../core/audio-station.mjs";
import { apexPureStore } from "../core/apex-pure-store.mjs";

const CONCURRENCY=Math.max(1,Number(process.env.APEX_VOICEOVER_CONCURRENCY||process.env.APEX_JOB_CONCURRENCY||4));
const POLL_MS=Math.max(250,Number(process.env.APEX_VOICEOVER_POLL_MS||1000));
const OUT_DIR=process.env.APEX_VOICEOVER_DIR||path.join(process.env.STORAGE_DIR||"./data/runtime/storage","voiceover");
const MAX_ATTEMPTS=Math.max(1,Number(process.env.APEX_VOICEOVER_MAX_ATTEMPTS||3));
let stopping=false;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

export async function enqueueVoiceoverJob(input={},options={}){await apexPureStore.init();const id=String(options.id||input.id||crypto.randomUUID());await apexPureStore.put("voiceover_jobs",id,{id,text:String(input.text||""),provider:String(input.provider||"auto"),voice:input.voice||null,language:input.language||"en-US",speed:Number(input.speed||1),pitch:Number(input.pitch||0),format:String(input.format||"wav"),priority:Number(options.priority||input.priority||0),status:"queued",attempts:0,createdAt:new Date().toISOString()});return id;}
async function synth(job){const p={voice:job.voice,language:job.language,speed:job.speed,pitch:job.pitch,format:job.format};const order=job.provider==="auto"?String(process.env.APEX_VOICEOVER_PROVIDER_ORDER||"local").split(",").map(x=>x.trim()).filter(Boolean):[job.provider];let last;
for(const provider of order){try{if(provider==="local"){const file=(await synthesizeSpeech({...p,text:job.text,outputDir:OUT_DIR})).path;return{provider,file,bytes:(await fs.stat(file)).size};}
if(provider==="elevenlabs"&&process.env.ELEVENLABS_API_KEY){const voice=p.voice||process.env.ELEVENLABS_VOICE_ID;if(!voice)throw Error("ElevenLabs voice_id required");const r=await fetch("https://api.elevenlabs.io/v1/text-to-speech/"+encodeURIComponent(voice)+"?output_format=mp3_44100_192",{method:"POST",headers:{"xi-api-key":process.env.ELEVENLABS_API_KEY,"content-type":"application/json"},body:JSON.stringify({text:job.text,model_id:process.env.ELEVENLABS_MODEL||"eleven_multilingual_v2",voice_settings:{speed:Number(p.speed||1)}})});if(!r.ok)throw Error("ElevenLabs "+r.status);const b=Buffer.from(await r.arrayBuffer());await fs.mkdir(OUT_DIR,{recursive:true});const file=path.join(OUT_DIR,job.id+".mp3");await fs.writeFile(file,b);return{provider,file,bytes:b.length};}
if(provider==="google"&&process.env.GOOGLE_TTS_API_KEY){const r=await fetch("https://texttospeech.googleapis.com/v1/text:synthesize?key="+encodeURIComponent(process.env.GOOGLE_TTS_API_KEY),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({input:{text:job.text},voice:{languageCode:p.language||"en-US",name:p.voice||process.env.GOOGLE_TTS_VOICE||"en-US-Neural2-D"},audioConfig:{audioEncoding:"MP3",speakingRate:Number(p.speed||1),pitch:Number(p.pitch||0)}})});if(!r.ok)throw Error("Google TTS "+r.status);const b=Buffer.from((await r.json()).audioContent||"","base64");await fs.mkdir(OUT_DIR,{recursive:true});const file=path.join(OUT_DIR,job.id+".mp3");await fs.writeFile(file,b);return{provider,file,bytes:b.length};}
}catch(e){last=e;}}
throw last||Error("No voiceover provider available");}
async function claim(){const rows=await apexPureStore.query("voiceover_jobs",x=>x.status==="queued",{sort:(a,b)=>(Number(b.priority)-Number(a.priority))||String(a.createdAt).localeCompare(String(b.createdAt)),limit:1});const j=rows[0];if(!j)return null;await apexPureStore.put("voiceover_jobs",j.id,{...j,status:"running",attempts:Number(j.attempts||0)+1,startedAt:new Date().toISOString()});return apexPureStore.get("voiceover_jobs",j.id);}
async function loop(){while(!stopping){const job=await claim();if(!job){await sleep(POLL_MS);continue;}try{const r=await synth(job);await apexPureStore.put("voiceover_jobs",job.id,{...job,status:"completed",finishedAt:new Date().toISOString(),outputPath:r.file,bytes:r.bytes,result:r,error:null});}catch(e){const retry=Number(job.attempts)<MAX_ATTEMPTS;await apexPureStore.put("voiceover_jobs",job.id,{...job,status:retry?"queued":"failed",error:String(e?.stack||e).slice(0,20000),finishedAt:retry?null:new Date().toISOString()});}}}
export async function startVoiceoverWorker(){await apexPureStore.init();await Promise.all(Array.from({length:CONCURRENCY},loop));}
export async function listVoiceCatalog(){return(await listVoiceOptions()).map(v=>({...v,provider:"local"}));}
export async function voiceoverWorkerStatus(){await apexPureStore.init();const rows=await apexPureStore.list("voiceover_jobs");return{concurrency:CONCURRENCY,queued:rows.filter(x=>x.status==="queued").length,running:rows.filter(x=>x.status==="running").length,providers:{elevenlabs:Boolean(process.env.ELEVENLABS_API_KEY),google:Boolean(process.env.GOOGLE_TTS_API_KEY),local:true}};}
for(const signal of ["SIGINT","SIGTERM"])process.once(signal,()=>{stopping=true;});
if(process.argv[1]&&new URL(import.meta.url).pathname===new URL(process.argv[1],"file:").pathname)await startVoiceoverWorker();
