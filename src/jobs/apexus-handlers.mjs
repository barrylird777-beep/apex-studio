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
    const generated=await generateText(`${base}\\nCreate the story bible for this episode: premise, protagonist, supporting cast, world rules, conflict, escalation, reversal, climax, emotional payoff, and a 30-second opening hook. Avoid existing franchises.`);
    metadata.provider=generated.provider;
    file=await writeText(code,stage,"story.md",generated.text);
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
  }else if(stage==="qc"){
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
