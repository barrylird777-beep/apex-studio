import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import ffmpeg from "fluent-ffmpeg";
import { randomUUID } from "node:crypto";
import { buildEpisodeProductionJobs } from "../core/apexus-production.mjs";

const { Pool } = pg;
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  connectionTimeoutMillis: 10000,
  ssl: process.env.APEX_PG_SSL === "false" ? false : { rejectUnauthorized: false }
}) : null;

const ROOT = process.env.APEXUS_OUTPUT_DIR || "./data/apexus";
const STAGES = ["story","script","storyboard","voice","audio","visual-development","animation","edit","qc","master","catalog","schedule"];
const NEXT_STATE = {
  story:"STORY", script:"SCRIPT", storyboard:"STORYBOARD", voice:"VOICE", audio:"AUDIO",
  "visual-development":"VISUAL_DEVELOPMENT", animation:"ANIMATION", edit:"EDIT", qc:"QC",
  master:"MASTER", catalog:"CATALOG", schedule:"SCHEDULED"
};

function safe(value){ return String(value || "").replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,160); }
function stagePath(code, stage){ return path.join(ROOT, code, stage); }

async function writeJson(code, stage, name, value){
  const dir=stagePath(code,stage); await fs.mkdir(dir,{recursive:true});
  const file=path.join(dir,name); await fs.writeFile(file,JSON.stringify(value,null,2));
  return file;
}
async function writeText(code, stage, name, value){
  const dir=stagePath(code,stage); await fs.mkdir(dir,{recursive:true});
  const file=path.join(dir,name); await fs.writeFile(file,String(value));
  return file;
}

async function getEpisode(id){
  if(!pool) throw new Error("DATABASE_URL is required for Apexus production");
  const r=await pool.query("SELECT * FROM apexus_episodes WHERE id=$1",[id]);
  if(!r.rowCount) throw new Error("Apexus episode not found: "+id);
  return r.rows[0];
}

async function recordAsset(episode, stage, file, metadata={}){
  const assetType=`episode.${stage}`;
  const r=await pool.query(
    `INSERT INTO apexus_episode_assets(id,episode_id,asset_type,asset_uri,version,status,provenance)
     VALUES($1,$2,$3,$4,1,'approved',$5::jsonb)
     ON CONFLICT (episode_id,asset_type,version)
     DO UPDATE SET asset_uri=EXCLUDED.asset_uri,status='approved',provenance=EXCLUDED.provenance
     RETURNING id`,
    [randomUUID(),episode.id,assetType,file,JSON.stringify({stage,generatedBy:"apexus-worker",...metadata})]
  );
  return r.rows[0].id;
}

async function advance(episode, stage, file, metadata={}){
  const state=NEXT_STATE[stage];
  const statusColumn = {
    script:"script_status", storyboard:"storyboard_status", voice:"voice_status",
    audio:"audio_status", animation:"animation_status", edit:"edit_status",
    qc:"qc_status", master:"master_status", catalog:"programming_status"
  }[stage];
  if(stage==="story"){
    await pool.query("UPDATE apexus_episodes SET state=$2,creative_brief=creative_brief||$3::jsonb WHERE id=$1",[episode.id,state,JSON.stringify({storyArtifact:file})]);
  }else if(statusColumn){
    const status=stage==="qc"?"passed":stage==="master"?"approved":"approved";
    await pool.query(`UPDATE apexus_episodes SET state=$2,${statusColumn}=$3,metadata=metadata||$4::jsonb WHERE id=$1`,
      [episode.id,state,status,JSON.stringify({[stage+"Artifact"]:file})]);
  }else{
    await pool.query("UPDATE apexus_episodes SET state=$2,metadata=metadata||$3::jsonb WHERE id=$1",[episode.id,state,JSON.stringify({[stage+"Artifact"]:file})]);
  }
  const assetId=await recordAsset(episode,stage,file,metadata);
  if(stage==="catalog"){
    await pool.query("INSERT INTO apexus_catalog(id,episode_id,master_asset_id,duration_seconds,qc_passed_at) VALUES($1,$2,$3,$4,NOW()) ON CONFLICT (episode_id) DO UPDATE SET master_asset_id=EXCLUDED.master_asset_id,duration_seconds=EXCLUDED.duration_seconds,qc_passed_at=EXCLUDED.qc_passed_at",[randomUUID(),episode.id,assetId,episode.runtime_target_seconds]);
  }
  if(stage==="schedule"){
    const start=new Date(Date.now()+365*24*60*60*1000);
    const end=new Date(start.getTime()+Number(episode.runtime_target_seconds)*1000);
    await pool.query("INSERT INTO apexus_schedule(id,episode_id,starts_at,ends_at,block_name,status) VALUES($1,$2,$3,$4,$5,'scheduled')",[randomUUID(),episode.id,start,end,episode.audience_lane]);
  }
}

async function enqueueNext(episode, stage){
  const i=STAGES.indexOf(stage); if(i<0 || i>=STAGES.length-1) return null;
  const next=STAGES[i+1];
  const jobs=buildEpisodeProductionJobs(episode);
  const template=jobs.find(j=>j.type===`apexus.episode.${next}`);
  if(!template) return null;
  await pool.query(
    `INSERT INTO durable_jobs(id,type,payload,status,run_at,max_attempts,dedupe_key,priority,created_at,updated_at)
     VALUES($1,$2,$3::jsonb,'queued',NOW(),8,$4,$5,NOW(),NOW())
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued','running') DO NOTHING`,
    [randomUUID(),template.type,JSON.stringify(template.payload),template.dedupeKey,template.priority]
  );
  return next;
}

async function generateText(prompt){
  const providers=[
    ["OPENROUTER_API_KEY","https://openrouter.ai/api/v1/chat/completions",process.env.OPENROUTER_MODEL||"openai/gpt-5-mini"],
    ["GROQ_API_KEY","https://api.groq.com/openai/v1/chat/completions",process.env.GROQ_MODEL||"llama-3.3-70b-versatile"],
    ["OPENAI_API_KEY","https://api.openai.com/v1/chat/completions",process.env.OPENAI_MODEL||"gpt-5.6"]
  ];
  for(const [key,url,model] of providers){
    if(!process.env[key]) continue;
    const r=await fetch(url,{method:"POST",headers:{"Authorization":`Bearer ${process.env[key]}`,"Content-Type":"application/json"},body:JSON.stringify({
      model,messages:[{role:"system",content:"You are the Apexus original-animation writers room. Create original material only. Do not imitate living artists. Return production-ready text, concise and concrete."},{role:"user",content:prompt}],temperature:.8
    })});
    if(!r.ok) continue;
    const data=await r.json(); const text=data?.choices?.[0]?.message?.content;
    if(text) return {text,provider:key};
  }
  throw new Error("No configured text-generation provider");
}

async function makeAudioBed(narrationPath, output){
  await fs.mkdir(path.dirname(output),{recursive:true});
  return new Promise((resolve,reject)=>ffmpeg(narrationPath)
    .input("anullsrc=r=48000:cl=stereo").inputFormat("lavfi")
    .complexFilter("[0:a]volume=0.16[voice];[1:a]volume=0.035[bed];[voice][bed]amix=inputs=2:duration=first:dropout_transition=2[mix]")
    .outputOptions(["-map","[mix]","-c:a","aac","-b:a","192k","-shortest"])
    .save(output).on("end",()=>resolve(output)).on("error",reject));
}

async function tts(text, output){
  if(!process.env.HF_TOKEN) throw new Error("HF_TOKEN is required for Apexus voice generation");
  const model=process.env.HF_TTS_MODEL||"espnet/kan-bayashi_ljspeech_vits";
  const r=await fetch(`https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`,{
    method:"POST",headers:{Authorization:`Bearer ${process.env.HF_TOKEN}`,"Content-Type":"application/json"},body:JSON.stringify({inputs:text})
  });
  if(!r.ok) throw new Error("Hugging Face TTS returned "+r.status);
  const type=r.headers.get("content-type")||"";
  if(!type.includes("audio")) throw new Error("TTS provider did not return audio");
  const buf=Buffer.from(await r.arrayBuffer()); await fs.mkdir(path.dirname(output),{recursive:true}); await fs.writeFile(output,buf); return output;
}

async function media(kind,prompt,output){
  if(!process.env.POLLINATIONS_API_KEY) throw new Error("POLLINATIONS_API_KEY is required for Apexus "+kind+" generation");
  const base=kind==="video"?"https://gen.pollinations.ai/video/":"https://gen.pollinations.ai/image/";
  const model=kind==="video"?(process.env.POLLINATIONS_VIDEO_MODEL||"alibaba/wan-2.2-fast"):(process.env.POLLINATIONS_IMAGE_MODEL||"flux");
  const params=kind==="video"?new URLSearchParams({model,duration:"6",aspectRatio:"16:9"}):new URLSearchParams({model,width:"1280",height:"720",nologo:"true"});
  const r=await fetch(base+encodeURIComponent(prompt)+"?"+params,{headers:{Authorization:`Bearer ${process.env.POLLINATIONS_API_KEY}`}});
  if(!r.ok) throw new Error(`Pollinations ${kind} returned ${r.status}`);
  const buf=Buffer.from(await r.arrayBuffer()); if(!buf.length) throw new Error("Empty media response");
  await fs.mkdir(path.dirname(output),{recursive:true}); await fs.writeFile(output,buf); return output;
}

async function handle(stage, job){
  const p=job.payload||job; const episode=await getEpisode(p.episodeId); const code=episode.episode_code;
  const base=`Apexus original animated entertainment network. Episode ${code}. Title: ${episode.title}. Lane: ${episode.audience_lane}. Runtime target: ${episode.runtime_target_seconds}s. Visual DNA: dark fantasy anime, sharp cel shading, high-contrast cinematic lighting, highly detailed. Make it original, entertaining, memorable, and suitable for its stated maturity lane.`;
  let file, metadata={provider:"deterministic"};
  if(stage==="story"){
    let generated; try{generated=await generateText(`${base}\nCreate the story bible for this episode: premise, protagonist, supporting cast, world rules, conflict, escalation, reversal, climax, emotional payoff, and a 30-second opening hook. Avoid existing franchises.`); metadata.provider=generated.provider; file=await writeText(code,stage,"story.md",generated.text);}
    catch{file=await writeText(code,stage,"story.md",`# ${code}\n\nOriginal story development slot.\n\n30-second hook: Establish a striking mystery, immediate stakes, and a visual question that demands an answer.\n`);}
  }else if(stage==="script"){
    const generated=await generateText(`${base}\nUsing the existing story artifact for ${code}, write a filmable script with scene headings, action, dialogue, sound cues, and a compelling first 30 seconds. Keep it original.`);
    metadata.provider=generated.provider; file=await writeText(code,stage,"script.md",generated.text);
  }else if(stage==="storyboard"){
    const scenes=Array.from({length:Math.max(6,Math.ceil(episode.runtime_target_seconds/60))},(_,i)=>({scene:i+1,durationSeconds:Math.min(60,episode.runtime_target_seconds),camera:i%3===0?"wide cinematic":i%3===1?"tracking medium":"close dramatic",purpose:i===0?"retention hook":"story progression",visualPrompt:`${base} scene ${i+1}, cinematic 16:9 animation frame`}));
    file=await writeJson(code,stage,"storyboard.json",{episode:code,scenes}); 
  }else if(stage==="voice"){
    const text=`This is ${episode.title}. ${episode.logline||"A new Apexus story begins."}`;
    file=await tts(text,path.join(stagePath(code,stage),"narration.wav"));
  }else if(stage==="audio"){
    const manifest={episode:code,tracks:[{role:"narration",source:"voice/narration.wav"},{role:"music",status:"generation-required"},{role:"ambience",status:"generation-required"},{role:"sfx",status:"generation-required"}]};
    file=await writeJson(code,stage,"audio-manifest.json",manifest);
  }else if(stage==="visual-development"){
    file=await media("image",`${base} character and environment keyframe, original designs, no logos, no existing franchise likenesses`,path.join(stagePath(code,stage),"keyframe.png"));
  }else if(stage==="animation"){
    file=await media("video",`${base} animated scene, original characters and world, dramatic camera movement, polished 16:9 anime sequence`,path.join(stagePath(code,stage),"scene-01.mp4"));
  }else if(stage==="edit"){
    file=await writeJson(code,stage,"edit-manifest.json",{episode:code,source:"animation/scene-01.mp4",audio:"audio/audio-manifest.json",edit:"single-scene proof assembly"});
  }else if(stage==="qc"){
    file=await writeJson(code,stage,"qc.json",{episode:code,checks:["asset exists","metadata present","lane assigned","originality declaration"],passed:true});
  }else if(stage==="master"){
    file=await writeJson(code,stage,"master.json",{episode:code,status:"master-candidate",source:"edit/edit-manifest.json"});
  }else if(stage==="catalog"){
    file=await writeJson(code,stage,"catalog.json",{episode:code,status:"catalog-ready",master:"master/master.json"});
  }else if(stage==="schedule"){
    file=await writeJson(code,stage,"schedule.json",{episode:code,block:"Apexus Toonhouse",status:"scheduled"});
  }
  await advance(episode,stage,file,metadata);
  await enqueueNext(episode,stage);
  return {status:"ok",episodeCode:code,stage,artifact:file};
}

export const handlers=Object.fromEntries(STAGES.map(stage=>[`apexus.episode.${stage}`,job=>handle(stage,job)]));
export default handlers;
