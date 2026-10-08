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
audio:"audio_status", "visual-development":"visual_development_status", animation:"animation_status", edit:"edit_status",
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
    const master=await pool.query(
      "SELECT id FROM apexus_episode_assets WHERE episode_id=$1 AND asset_type='episode.master' ORDER BY version DESC LIMIT 1",
      [episode.id]
    );
    if(!master.rowCount) throw new Error("Catalog cannot register without a master asset");
    await pool.query(
      "INSERT INTO apexus_catalog(id,episode_id,master_asset_id,duration_seconds,qc_passed_at) VALUES($1,$2,$3,$4,NOW()) ON CONFLICT (episode_id) DO UPDATE SET master_asset_id=EXCLUDED.master_asset_id,duration_seconds=EXCLUDED.duration_seconds,qc_passed_at=EXCLUDED.qc_passed_at",
      [randomUUID(),episode.id,master.rows[0].id,episode.runtime_target_seconds]
    );
  }
  if(stage==="schedule"){
    await pool.query("DELETE FROM apexus_schedule WHERE episode_id=$1 AND status='scheduled'",[episode.id]);
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

async function makeAudioBed(narrationPath, output, runtimeSeconds){
  await fs.mkdir(path.dirname(output),{recursive:true});
  return new Promise((resolve,reject)=>ffmpeg(narrationPath)
    .input("anullsrc=r=48000:cl=stereo").inputFormat("lavfi")
    .complexFilter("[0:a]volume=0.16,apad[voice];[1:a]volume=0.035[bed];[voice][bed]amix=inputs=2:duration=longest:dropout_transition=2[mix]")
    .outputOptions(["-map","[mix]","-c:a","aac","-b:a","192k","-t",String(runtimeSeconds)])
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

export function buildAnimationPlan(runtimeSeconds){
  const runtime=Math.max(1,Math.ceil(Number(runtimeSeconds)||180));
  const sceneCount=Math.ceil(runtime/6);
  return Array.from({length:sceneCount},(_,i)=>({
    scene:i+1,
    durationSeconds:i===sceneCount-1 ? runtime-(sceneCount-1)*6 : 6
  }));
}

async function concatAnimation(sceneFiles, output, runtimeSeconds){
  const dir=path.dirname(output);
  await fs.mkdir(dir,{recursive:true});
  const list=path.join(dir,"concat.txt");
  await fs.writeFile(list,sceneFiles.map(file=>"file '"+file.replace(/'/g,"'\\''")+"'").join("\n")+"\n");
  try{
    await new Promise((resolve,reject)=>ffmpeg()
      .input(list).inputOptions(["-f","concat","-safe","0"])
      .outputOptions(["-an","-c:v","libx264","-preset","medium","-pix_fmt","yuv420p","-t",String(runtimeSeconds),"-movflags","+faststart"])
      .save(output).on("end",resolve).on("error",reject));
  }finally{ await fs.rm(list,{force:true}); }
  const stat=await fs.stat(output).catch(()=>null);
  if(!stat || stat.size<=0) throw new Error("Animation assembly produced an empty artifact");
  return output;
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
    const plan=buildAnimationPlan(episode.runtime_target_seconds);
    const scenes=plan.map(scene=>({
      ...scene,
      camera:scene.scene%3===1?"wide cinematic":scene.scene%3===2?"tracking medium":"close dramatic",
      purpose:scene.scene===1?"retention hook":"story progression",
      visualPrompt:`${base} scene ${scene.scene}, cinematic 16:9 animation frame`
    }));
    file=await writeJson(code,stage,"storyboard.json",{episode:code,scenes,totalDurationSeconds:scenes.reduce((sum,scene)=>sum+scene.durationSeconds,0)});
  }else if(stage==="voice"){
    const text=`This is ${episode.title}. ${episode.logline||"A new Apexus story begins."}`;
    file=await tts(text,path.join(stagePath(code,stage),"narration.wav"));
  }else if(stage==="audio"){
    const narration=path.join(stagePath(code,"voice"),"narration.wav");
    file=await makeAudioBed(narration,path.join(stagePath(code,stage),"episode-audio.m4a"),episode.runtime_target_seconds);
  }else if(stage==="visual-development"){
    file=await media("image",`${base} character and environment keyframe, original designs, no logos, no existing franchise likenesses`,path.join(stagePath(code,stage),"keyframe.png"));
  }else if(stage==="animation"){
    const storyboard=JSON.parse(await fs.readFile(path.join(stagePath(code,"storyboard"),"storyboard.json"),"utf8"));
    const scenes=Array.isArray(storyboard.scenes) ? storyboard.scenes : [];
    if(!scenes.length) throw new Error("Animation requires a storyboard with scenes");
    const sceneFiles=await Promise.all(scenes.map(scene=>media(
      "video",
      `${base} animated scene ${scene.scene}, duration target ${scene.durationSeconds}s, camera: ${scene.camera}, purpose: ${scene.purpose}, original characters and world, dramatic camera movement, polished 16:9 anime sequence`,
      path.join(stagePath(code,stage),`scene-${String(scene.scene).padStart(4,"0")}.mp4`)
    )));
    file=await concatAnimation(sceneFiles,path.join(stagePath(code,stage),"full-episode.mp4"),episode.runtime_target_seconds);
    metadata.sceneCount=sceneFiles.length;
  }else if(stage==="edit"){
    const video=path.join(stagePath(code,"animation"),"full-episode.mp4");
    const audio=path.join(stagePath(code,"audio"),"episode-audio.m4a");
    file=path.join(stagePath(code,stage),"episode-edit.mp4");
    await fs.mkdir(path.dirname(file),{recursive:true});
    await new Promise((resolve,reject)=>ffmpeg(video).input(audio)
      .outputOptions(["-map","0:v:0","-map","1:a:0","-c:v","copy","-c:a","aac","-b:a","192k","-t",String(episode.runtime_target_seconds),"-movflags","+faststart"])
      .save(file).on("end",resolve).on("error",reject));
  }  }else if(stage==="qc"){
    const required=[
      path.join(stagePath(code,"voice"),"narration.wav"),
      path.join(stagePath(code,"audio"),"episode-audio.m4a"),
      path.join(stagePath(code,"animation"),"full-episode.mp4"),
      path.join(stagePath(code,"edit"),"episode-edit.mp4")
    ];
    const checks=[];
    for(const target of required){
      const stat=await fs.stat(target).catch(()=>null);
      if(!stat || stat.size<=0) throw new Error("QC missing or empty asset: "+target);
      checks.push({asset:target,bytes:stat.size});
    }
    file=await writeJson(code,stage,"qc.json",{episode:code,checks,passed:true});
  }else if(stage==="master"){
    const source=path.join(stagePath(code,"edit"),"episode-edit.mp4");
    file=path.join(stagePath(code,stage),code+".mp4");
    await fs.mkdir(path.dirname(file),{recursive:true});
    await new Promise((resolve,reject)=>ffmpeg(source)
      .outputOptions(["-c","copy","-movflags","+faststart"])
      .save(file).on("end",resolve).on("error",reject));
  }else if(stage==="catalog"){
    file=await writeJson(code,stage,"catalog.json",{episode:code,status:"catalog-ready",master:`master/${code}.mp4`});
  }else if(stage==="schedule"){
    file=await writeJson(code,stage,"schedule.json",{episode:code,block:"Apexus Toonhouse",status:"scheduled"});
  }
  await advance(episode,stage,file,metadata);
  await enqueueNext(episode,stage);
  return {status:"ok",episodeCode:code,stage,artifact:file};
}

export const handlers=Object.fromEntries(STAGES.map(stage=>[`apexus.episode.${stage}`,job=>handle(stage,job)]));
export default handlers;
