import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Pool } from "pg";
import { synthesizeSpeech, listVoiceOptions } from "../core/audio-station.mjs";

const DATABASE_URL=process.env.DATABASE_URL;
if(!DATABASE_URL) throw new Error("DATABASE_URL is required; SQLite voiceover storage is disabled.");
const pool=new Pool({connectionString:DATABASE_URL,max:Math.min(8,Math.max(1,Number(process.env.APEX_VOICEOVER_DB_POOL_MAX||4))),idleTimeoutMillis:30000,connectionTimeoutMillis:10000});
const CONCURRENCY=Math.max(1,Number(process.env.APEX_VOICEOVER_CONCURRENCY||process.env.APEX_JOB_CONCURRENCY||4));
const POLL_MS=Math.max(250,Number(process.env.APEX_VOICEOVER_POLL_MS||1000));
const OUT_DIR=process.env.APEX_VOICEOVER_DIR||path.join(process.env.STORAGE_DIR||"./data/runtime/storage","voiceover");
const MAX_ATTEMPTS=Math.max(1,Number(process.env.APEX_VOICEOVER_MAX_ATTEMPTS||3));
const sleep=ms=>new Promise(r=>setTimeout(r,ms)); let stopping=false; let initialized=false;

async function initSchema(){if(initialized)return;await pool.query(`CREATE TABLE IF NOT EXISTS voiceover_jobs(
id UUID PRIMARY KEY,text TEXT NOT NULL,provider TEXT NOT NULL DEFAULT 'auto',voice TEXT,language TEXT,
speed REAL NOT NULL DEFAULT 1,pitch REAL NOT NULL DEFAULT 0,format TEXT NOT NULL DEFAULT 'wav',
status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed')),
attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),priority INTEGER NOT NULL DEFAULT 0,
available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
started_at TIMESTAMPTZ,finished_at TIMESTAMPTZ,output_path TEXT,bytes BIGINT,error TEXT,result_json JSONB)`);
await pool.query("CREATE INDEX IF NOT EXISTS idx_voiceover_pick ON voiceover_jobs(status,available_at,priority DESC,created_at)");initialized=true;}

export async function enqueueVoiceoverJob(input={},options={}){await initSchema();const id=options.id||input.id||crypto.randomUUID();await pool.query(`INSERT INTO voiceover_jobs(id,text,provider,voice,language,speed,pitch,format,priority) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING`,[id,String(input.text||""),String(input.provider||"auto"),input.voice||null,input.language||"en-US",Number(input.speed||1),Number(input.pitch||0),String(input.format||"wav"),Number(options.priority||input.priority||0)]);return id;}

async function synth(job){const p={voice:job.voice,language:job.language,speed:job.speed,pitch:job.pitch,format:job.format};const order=job.provider==="auto"?String(process.env.APEX_VOICEOVER_PROVIDER_ORDER||"local").split(",").map(x=>x.trim()).filter(Boolean):[job.provider];let last;
for(const provider of order){try{let b,file;
if(provider==="local"){file=(await synthesizeSpeech({...p,text:job.text,outputDir:OUT_DIR})).path;return{provider,file,bytes:(await fs.stat(file)).size};}
if(provider==="elevenlabs"&&process.env.ELEVENLABS_API_KEY){const voice=p.voice||process.env.ELEVENLABS_VOICE_ID;if(!voice)throw Error("ElevenLabs voice_id required");const r=await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_192`,{method:"POST",headers:{"xi-api-key":process.env.ELEVENLABS_API_KEY,"content-type":"application/json"},body:JSON.stringify({text:job.text,model_id:process.env.ELEVENLABS_MODEL||"eleven_multilingual_v2",voice_settings:{speed:Number(p.speed||1)}})});if(!r.ok)throw Error("ElevenLabs "+r.status);b=Buffer.from(await r.arrayBuffer());}
else if(provider==="google"&&process.env.GOOGLE_TTS_API_KEY){const voice=p.voice||process.env.GOOGLE_TTS_VOICE||"en-US-Neural2-D";const r=await fetch("https://texttospeech.googleapis.com/v1/text:synthesize?key="+encodeURIComponent(process.env.GOOGLE_TTS_API_KEY),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({input:{text:job.text},voice:{languageCode:p.language||"en-US",name:voice},audioConfig:{audioEncoding:"MP3",speakingRate:Number(p.speed||1),pitch:Number(p.pitch||0)}})});if(!r.ok)throw Error("Google TTS "+r.status);b=Buffer.from((await r.json()).audioContent||"","base64");}
else continue;
await fs.mkdir(OUT_DIR,{recursive:true});file=path.join(OUT_DIR,job.id+".mp3");await fs.writeFile(file,b);return{provider,file,bytes:b.length};}catch(e){last=e;}}
throw last||Error("No voiceover provider available");}

async function claim(){await initSchema();const c=await pool.connect();try{await c.query("BEGIN");const {rows}=await c.query(`SELECT * FROM voiceover_jobs WHERE status='queued' AND available_at<=NOW() ORDER BY priority DESC,created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1`);if(!rows[0]){await c.query("COMMIT");return null;}const {rows:u}=await c.query(`UPDATE voiceover_jobs SET status='running',attempts=attempts+1,started_at=NOW() WHERE id=$1 AND status='queued' RETURNING *`,[rows[0].id]);await c.query("COMMIT");return u[0]||null;}catch(e){await c.query("ROLLBACK").catch(()=>{});throw e;}finally{c.release();}}

async function loop(){while(!stopping){const job=await claim();if(!job){await sleep(POLL_MS);continue;}try{const r=await synth(job);await pool.query("UPDATE voiceover_jobs SET status='completed',finished_at=NOW(),output_path=$1,bytes=$2,result_json=$3,error=NULL WHERE id=$4",[r.file,r.bytes,JSON.stringify(r),job.id]);}catch(e){const retry=Number(job.attempts)<MAX_ATTEMPTS;const delay=retry?Math.min(300,2**Number(job.attempts)*5):0;await pool.query("UPDATE voiceover_jobs SET status=$1,available_at=NOW()+($2*INTERVAL '1 second'),error=$3,finished_at=CASE WHEN $1='failed' THEN NOW() ELSE NULL END WHERE id=$4",[retry?"queued":"failed",delay,String(e?.stack||e).slice(0,20000),job.id]);}}}

export async function startVoiceoverWorker(){await initSchema();await Promise.all(Array.from({length:CONCURRENCY},loop));}
export async function listVoiceCatalog(){return (await listVoiceOptions()).map(v=>({...v,provider:"local"}));}
export async function voiceoverWorkerStatus(){await initSchema();const {rows:[q]}=await pool.query("SELECT COUNT(*)::int n FROM voiceover_jobs WHERE status='queued'");const {rows:[r]}=await pool.query("SELECT COUNT(*)::int n FROM voiceover_jobs WHERE status='running'");return{concurrency:CONCURRENCY,queued:q?.n||0,running:r?.n||0,providers:{elevenlabs:Boolean(process.env.ELEVENLABS_API_KEY),google:Boolean(process.env.GOOGLE_TTS_API_KEY),local:true}};}
for(const s of["SIGINT","SIGTERM"])process.once(s,()=>{stopping=true;pool.end().catch(()=>{});});
if(process.argv[1]&&new URL(import.meta.url).pathname===new URL(process.argv[1],"file:").pathname)await startVoiceoverWorker();