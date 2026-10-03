import sqlite3 from "sqlite3";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { uid } from "../core/id.mjs";
import { synthesizeSpeech, listVoiceOptions } from "../core/audio-station.mjs";

const DB_FILE=process.env.APEX_VOICEOVER_DB_FILE||process.env.APEX_PRODUCTION_DB_FILE||"./apex-production.sqlite";
const CONCURRENCY=Math.max(1,Number(process.env.APEX_VOICEOVER_CONCURRENCY||process.env.APEX_JOB_CONCURRENCY||4));
const POLL_MS=Math.max(250,Number(process.env.APEX_VOICEOVER_POLL_MS||1000));
const OUT_DIR=process.env.APEX_VOICEOVER_DIR||path.join(process.env.STORAGE_DIR||"./data/runtime/storage","voiceover");
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let db; let stopping=false;

function openDb(){if(db)return db;db=new sqlite3.Database(DB_FILE);db.configure("busyTimeout",10000);return db}
function run(sql,p=[]){return new Promise((resolve,reject)=>openDb().run(sql,p,function(e){e?reject(e):resolve(this)}))}
function get(sql,p=[]){return new Promise((resolve,reject)=>openDb().get(sql,p,(e,row)=>e?reject(e):resolve(row)))}
async function initSchema(){await run(`CREATE TABLE IF NOT EXISTS voiceover_jobs(
id TEXT PRIMARY KEY,text TEXT NOT NULL,provider TEXT NOT NULL DEFAULT 'auto',voice TEXT,language TEXT,
speed REAL DEFAULT 1,pitch REAL DEFAULT 0,format TEXT DEFAULT 'wav',status TEXT DEFAULT 'queued',
attempts INTEGER DEFAULT 0,priority INTEGER DEFAULT 0,available_at INTEGER DEFAULT (unixepoch()),
created_at INTEGER DEFAULT (unixepoch()),started_at INTEGER,finished_at INTEGER,output_path TEXT,
bytes INTEGER,error TEXT,result_json TEXT)`);await run("CREATE INDEX IF NOT EXISTS idx_voiceover_pick ON voiceover_jobs(status,available_at,priority DESC,created_at)")}
export async function enqueueVoiceoverJob(input={},options={}){await initSchema();const id=options.id||input.id||uid("voice");await run("INSERT INTO voiceover_jobs(id,text,provider,voice,language,speed,pitch,format,priority) VALUES(?,?,?,?,?,?,?,?,?)",[id,String(input.text||""),String(input.provider||"auto"),input.voice||"",input.language||"en-US",Number(input.speed||1),Number(input.pitch||0),String(input.format||"wav"),Number(options.priority||input.priority||0)]);return id}

async function eleven(text,p){if(!process.env.ELEVENLABS_API_KEY)throw new Error("ElevenLabs not configured");const voice=p.voice||process.env.ELEVENLABS_VOICE_ID;if(!voice)throw new Error("ElevenLabs voice_id required");const model=p.model||process.env.ELEVENLABS_MODEL||"eleven_multilingual_v2";const r=await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=${p.format==="wav"?"pcm_44100":"mp3_44100_192"}`,{method:"POST",headers:{"xi-api-key":process.env.ELEVENLABS_API_KEY,"content-type":"application/json"},body:JSON.stringify({text,model_id:model,voice_settings:{speed:Number(p.speed||1)}})});if(!r.ok)throw new Error("ElevenLabs "+r.status);return Buffer.from(await r.arrayBuffer())}
async function google(text,p){if(!process.env.GOOGLE_TTS_API_KEY)throw new Error("Google TTS not configured");const voice=p.voice||process.env.GOOGLE_TTS_VOICE||"en-US-Neural2-D";const language=p.language||voice.split("-").slice(0,2).join("-");const r=await fetch("https://texttospeech.googleapis.com/v1/text:synthesize?key="+encodeURIComponent(process.env.GOOGLE_TTS_API_KEY),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({input:{text},voice:{languageCode:language,name:voice},audioConfig:{audioEncoding:p.format==="wav"?"LINEAR16":"MP3",speakingRate:Number(p.speed||1),pitch:Number(p.pitch||0)}})});if(!r.ok)throw new Error("Google TTS "+r.status);const d=await r.json();return Buffer.from(d.audioContent||"","base64")}
async function azure(text,p){if(!process.env.AZURE_SPEECH_KEY||!process.env.AZURE_SPEECH_REGION)throw new Error("Azure Speech not configured");const voice=p.voice||process.env.AZURE_SPEECH_VOICE||"en-US-AvaMultilingualNeural";const lang=p.language||voice.split("-").slice(0,2).join("-");const ssml=`<speak version="1.0" xml:lang="${lang}" xmlns="http://www.w3.org/2001/10/synthesis"><voice name="${voice}"><prosody rate="${Math.round((Number(p.speed||1)-1)*100)}%" pitch="${Number(p.pitch||0)}st">${String(text).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</prosody></voice></speak>`;const r=await fetch(`https://${process.env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`,{method:"POST",headers:{"Ocp-Apim-Subscription-Key":process.env.AZURE_SPEECH_KEY,"Content-Type":"application/ssml+xml","X-Microsoft-OutputFormat":p.format==="wav"?"riff-48khz-16bit-mono-pcm":"audio-48khz-192kbitrate-mono-mp3"},body:ssml});if(!r.ok)throw new Error("Azure Speech "+r.status);return Buffer.from(await r.arrayBuffer())}
async function local(text,p){return (await synthesizeSpeech({text,voice:p.voice,speed:p.speed,pitch:p.pitch,format:p.format,outputDir:OUT_DIR})).path}
async function generate(job){const p={voice:job.voice,language:job.language,speed:job.speed,pitch:job.pitch,format:job.format,model:job.model};const order=job.provider==="auto"?String(process.env.APEX_VOICEOVER_PROVIDER_ORDER||"elevenlabs,azure,google,local").split(",").map(x=>x.trim()).filter(Boolean):[job.provider];let last;for(const provider of order){try{if(provider==="elevenlabs"){const b=await eleven(job.text,p);const ext=job.format==="wav"?"wav":"mp3";const file=path.join(OUT_DIR,job.id+"."+ext);await fs.mkdir(OUT_DIR,{recursive:true});await fs.writeFile(file,b);return {provider,file,bytes:b.length}}if(provider==="google"){const b=await google(job.text,p);const ext=job.format==="wav"?"wav":"mp3";const file=path.join(OUT_DIR,job.id+"."+ext);await fs.mkdir(OUT_DIR,{recursive:true});await fs.writeFile(file,b);return {provider,file,bytes:b.length}}if(provider==="azure"){const b=await azure(job.text,p);const ext=job.format==="wav"?"wav":"mp3";const file=path.join(OUT_DIR,job.id+"."+ext);await fs.mkdir(OUT_DIR,{recursive:true});await fs.writeFile(file,b);return {provider,file,bytes:b.length}}if(provider==="local"){const file=await local(job.text,p);return {provider,file,bytes:(await fs.stat(file)).size}}}catch(e){last=e}}throw last||new Error("No voiceover provider available")}
async function claim(){const now=Math.floor(Date.now()/1000);return new Promise((resolve,reject)=>{openDb().serialize(()=>{db.run("BEGIN IMMEDIATE",e=>{if(e)return reject(e);db.get("SELECT * FROM voiceover_jobs WHERE status='queued' AND available_at<=? ORDER BY priority DESC,created_at ASC LIMIT 1",[now],(se,row)=>{if(se)return db.run("ROLLBACK",()=>reject(se));if(!row)return db.run("COMMIT",e2=>e2?reject(e2):resolve(null));db.run("UPDATE voiceover_jobs SET status='running',attempts=attempts+1,started_at=? WHERE id=? AND status='queued'",[now,row.id],function(ue){if(ue)return db.run("ROLLBACK",()=>reject(ue));db.run("COMMIT",ce=>ce?reject(ce):resolve({...row,attempts:row.attempts+1}))})})})})})}
async function loop(){while(!stopping){const j=await claim();if(!j){await sleep(POLL_MS);continue}try{const r=await generate(j);await run("UPDATE voiceover_jobs SET status='completed',finished_at=?,output_path=?,bytes=?,result_json=?,error=NULL WHERE id=?",[Math.floor(Date.now()/1000),r.file,r.bytes,JSON.stringify(r),j.id])}catch(e){const retry=j.attempts<Number(process.env.APEX_VOICEOVER_MAX_ATTEMPTS||3);await run("UPDATE voiceover_jobs SET status=?,available_at=?,error=? WHERE id=?",[retry?"queued":"failed",Math.floor(Date.now()/1000)+(retry?Math.min(300,2**j.attempts*5):0),String(e?.stack||e).slice(0,20000),j.id])}}}
export async function startVoiceoverWorker(){await initSchema();await Promise.all(Array.from({length:CONCURRENCY},loop))}
export async function listVoiceCatalog(){
  const voices=[...(await listVoiceOptions()).map(v=>({...v,provider:"local"}))];
  if(process.env.ELEVENLABS_API_KEY)try{
    const r=await fetch("https://api.elevenlabs.io/v2/voices",{headers:{"xi-api-key":process.env.ELEVENLABS_API_KEY}});
    if(r.ok){const d=await r.json();for(const v of d.voices||[])voices.push({id:v.voice_id,provider:"elevenlabs",label:v.name,language:v.labels?.language||"multilingual",category:v.category||"library",labels:v.labels||{}})}
  }catch{}
  if(process.env.GOOGLE_TTS_API_KEY)try{
    const r=await fetch("https://texttospeech.googleapis.com/v1/voices?key="+encodeURIComponent(process.env.GOOGLE_TTS_API_KEY));
    if(r.ok){const d=await r.json();for(const v of d.voices||[])for(const x of v.voice||[])voices.push({id:x.name,provider:"google",label:x.name,language:v.languageCodes?.[0]||"",gender:x.ssmlGender||"unspecified"})}
  }catch{}
  if(process.env.AZURE_SPEECH_KEY&&process.env.AZURE_SPEECH_REGION)try{
    const r=await fetch("https://"+process.env.AZURE_SPEECH_REGION+".tts.speech.microsoft.com/cognitiveservices/voices/list",{headers:{"Ocp-Apim-Subscription-Key":process.env.AZURE_SPEECH_KEY}});
    if(r.ok){const d=await r.json();for(const v of d)voices.push({id:v.ShortName,provider:"azure",label:v.DisplayName,language:v.Locale,styles:v.StyleList||[]})}
  }catch{}
  return voices;
}

export async function voiceoverWorkerStatus(){await initSchema();const q=await get("SELECT COUNT(*) AS n FROM voiceover_jobs WHERE status='queued'");const r=await get("SELECT COUNT(*) AS n FROM voiceover_jobs WHERE status='running'");return {concurrency:CONCURRENCY,queued:q?.n||0,running:r?.n||0,providers:{elevenlabs:Boolean(process.env.ELEVENLABS_API_KEY),azure:Boolean(process.env.AZURE_SPEECH_KEY),google:Boolean(process.env.GOOGLE_TTS_API_KEY),local:true}}}
for(const s of ["SIGINT","SIGTERM"])process.once(s,()=>{stopping=true});
if(process.argv[1]&&new URL(import.meta.url).pathname===new URL(process.argv[1],"file:").pathname)await startVoiceoverWorker();
