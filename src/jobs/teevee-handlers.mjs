import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import path from "node:path";
import ffmpeg from "fluent-ffmpeg";
import { randomUUID, createHash } from "node:crypto";
import { buildEpisodeProductionJobs } from "../core/teevee-production.mjs";
import { apexPureStore } from "../core/apex-pure-store.mjs";
import { createRemotePureStore } from "../core/remote-pure-store.mjs";


const ROOT = process.env.TEEVEE_OUTPUT_DIR || path.join(process.env.STORAGE_DIR || "/srv/apex/se-x", "teevee");
const teeveeStore = process.env.APEX_WORKER_API_URL && process.env.APEX_WORKER_TOKEN ? createRemotePureStore() : apexPureStore;

function teeveeObjectStore() {
  const endpoint = String(process.env.APEX_OBJECT_STORAGE_ENDPOINT || "").trim();
  const bucket = String(process.env.APEX_OBJECT_STORAGE_BUCKET || "").trim();
  const accessKeyId = String(process.env.APEX_OBJECT_STORAGE_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(process.env.APEX_OBJECT_STORAGE_SECRET_ACCESS_KEY || "").trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) throw new Error("TeeVee object storage is not configured");
  return { bucket, client: new S3Client({ endpoint, region: String(process.env.APEX_OBJECT_STORAGE_REGION || "auto"), forcePathStyle: false, credentials: { accessKeyId, secretAccessKey } }) };
}

function artifactKey(code, stage, file) {
  return `teevee/${safe(code)}/${safe(stage)}/${safe(path.basename(file))}`;
}

async function uploadArtifact(code, stage, file) {
  const { bucket, client } = teeveeObjectStore();
  const key = artifactKey(code, stage, file);
  const stat = await fs.stat(file);
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: `mobile/apex-business/${key}`, Body: createReadStream(file), ContentLength: stat.size, ContentType: path.extname(file).toLowerCase() === ".mp4" ? "video/mp4" : path.extname(file).toLowerCase() === ".wav" ? "audio/wav" : "application/octet-stream" }));
  return key;
}

async function restoreEpisodeArtifacts(episode) {
  const assets = typeof teeveeStore.queryFiltered === "function"
    ? await teeveeStore.queryFiltered("teevee_episode_assets", { episodeId: episode.id }, { limit: 500 })
    : (await teeveeStore.list("teevee_episode_assets")).filter(asset => String(asset.episodeId || asset.episode_id || "") === episode.id);
  if (!assets.length) return;
  const { bucket, client } = teeveeObjectStore();
  for (const asset of assets) {
    const key = String(asset.assetUri || asset.asset_uri || "");
    const assetType = String(asset.assetType || asset.asset_type || "");
    if (!key.startsWith("teevee/") || !assetType.startsWith("episode.")) continue;
    const stage = assetType.slice("episode.".length);
    const filename = path.basename(key);
    const localPath = path.join(stagePath(episode.episode_code, stage), filename);
    const recordedAt = Date.parse(String(asset.createdAt || ""));
    const present = await fs.stat(localPath).then(info => info.isFile() && info.size > 0 && Number.isFinite(recordedAt) && info.mtimeMs > recordedAt).catch(() => false);
    if (present) continue;
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: `mobile/apex-business/${key}` }));
    await pipeline(result.Body, createWriteStream(localPath, { mode: 0o600 }));
  }
}
const STAGES = ["story","script","storyboard","voice","audio","visual-development","animation","edit","qc","master","inspection","catalog","schedule"];
const NEXT_STATE = {
  story:"STORY", script:"SCRIPT", storyboard:"STORYBOARD", voice:"VOICE", audio:"AUDIO",
  "visual-development":"VISUAL_DEVELOPMENT", animation:"ANIMATION", edit:"EDIT", qc:"QC",
  master:"MASTER", inspection:"INSPECTION", catalog:"CATALOG", schedule:"SCHEDULED"
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

function normalizeEpisode(row = {}) {
  const episodeCode = String(row.episodeCode || row.episode_code || "");
  const runtimeTargetSeconds = Math.max(1, Number(row.runtimeTargetSeconds ?? row.runtime_target_seconds ?? 120));
  const creativeBrief = row.creativeBrief && typeof row.creativeBrief === "object"
    ? row.creativeBrief
    : row.creative_brief && typeof row.creative_brief === "object" ? row.creative_brief : {};
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return {
    ...row,
    id: String(row.id || ""),
    episodeCode,
    episode_code: episodeCode,
    runtimeTargetSeconds,
    runtime_target_seconds: runtimeTargetSeconds,
    creativeBrief,
    creative_brief: creativeBrief,
    metadata,
    state: String(row.state || "IDEA")
  };
}

async function getEpisode(id) {
  let row = await teeveeStore.get("teevee_episodes", String(id));
  if (!row) {
    if (typeof teeveeStore.queryFiltered === "function") {
      row = (await teeveeStore.queryFiltered("teevee_episodes", { episodeCode: String(id) }, { limit: 1 }))[0]
        || (await teeveeStore.queryFiltered("teevee_episodes", { episode_code: String(id) }, { limit: 1 }))[0]
        || null;
    } else {
      const all = await teeveeStore.list("teevee_episodes");
      row = all.find(item => String(item.id) === String(id) || item.episodeCode === String(id) || item.episode_code === String(id));
    }
  }
  if (!row) throw new Error("TeeVee episode not found in Pure-WAL storage: " + id);
  return normalizeEpisode(row);
}

async function recordAsset(episode, stage, fileUri, metadata = {}) {
  const assetType = `episode.${stage}`;
  const id = createHash("sha256").update(`${episode.id}|${assetType}|1`).digest("hex");
  const record = {
    id,
    episodeId: episode.id,
    episode_id: episode.id,
    assetType,
    asset_type: assetType,
    assetUri: fileUri,
    asset_uri: fileUri,
    version: 1,
    status: "approved",
    provenance: { stage, generatedBy: "teevee-worker", ...metadata },
    createdAt: new Date().toISOString()
  };
  await teeveeStore.put("teevee_episode_assets", id, record);
  return id;
}

async function updateEpisode(id, updater) {
  return teeveeStore.withMutationLock(async () => {
    const row = await teeveeStore.get("teevee_episodes", String(id));
    if (!row) throw new Error("TeeVee episode not found in Pure-WAL storage: " + id);
    const current = normalizeEpisode(row);
    const next = normalizeEpisode(await updater(current));
    next.updatedAt = new Date().toISOString();
    await teeveeStore.put("teevee_episodes", next.id, next);
    return next;
  });
}

async function advance(episode, stage, file, metadata = {}) {
  const state = NEXT_STATE[stage];
  const statusColumn = {
    script: "script_status", storyboard: "storyboard_status", voice: "voice_status",
    audio: "audio_status", "visual-development": "visual_development_status",
    animation: "animation_status", edit: "edit_status", qc: "qc_status",
    master: "master_status", catalog: "programming_status"
  }[stage];
  const storedArtifact = await uploadArtifact(episode.episode_code, stage, file);

  await updateEpisode(episode.id, current => {
    const next = { ...current, state, metadata: { ...current.metadata, [stage + "Artifact"]: storedArtifact } };
    if (stage === "story") next.creative_brief = { ...current.creative_brief, storyArtifact: storedArtifact };
    if (statusColumn) next[statusColumn] = stage === "qc" ? "passed" : stage === "master" ? "approved" : "approved";
    if (stage === "inspection") {
      next.metadata = { ...next.metadata, inspectionApproved: true, inspectionAuthority: "king_cob" };
    }
    if (stage === "catalog") next.metadata = { ...next.metadata, catalogRegistered: true };
    if (stage === "schedule") next.metadata = { ...next.metadata, scheduleReady: true, scheduled: true };
    return next;
  });

  const assetId = await recordAsset(episode, stage, storedArtifact, metadata);
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  const sha256 = digest.digest("hex");
  const provenanceId = createHash("sha256").update(`${episode.id}|${stage}|provenance`).digest("hex");
  await teeveeStore.put("asset_provenance", provenanceId, {
    id: provenanceId,
    runId: episode.id,
    run_id: episode.id,
    kind: stage,
    status: "approved",
    artifactId: String(assetId),
    artifact_id: String(assetId),
    path: storedArtifact,
    sha256,
    labels: ["TeeVee", stage],
    sources: [episode.episode_code],
    spec: { stage, episodeCode: episode.episode_code },
    metadata
  });

  if (stage === "catalog") {
    const masters = typeof teeveeStore.queryFiltered === "function"
      ? await teeveeStore.queryFiltered("teevee_episode_assets", { episodeId: episode.id, assetType: "episode.master" }, { sortField: "version", descending: true, limit: 1 })
      : await teeveeStore.query("teevee_episode_assets", asset => asset.episodeId === episode.id && asset.assetType === "episode.master", { sort: (a, b) => Number(b.version || 0) - Number(a.version || 0), limit: 1 });
    if (!masters.length) throw new Error("Catalog cannot register without a master asset");
    const catalogId = createHash("sha256").update(`teevee-catalog|${episode.id}`).digest("hex");
    await teeveeStore.put("teevee_catalog", catalogId, {
      id: catalogId,
      episodeId: episode.id,
      episode_id: episode.id,
      masterAssetId: masters[0].id,
      master_asset_id: masters[0].id,
      durationSeconds: episode.runtime_target_seconds,
      duration_seconds: episode.runtime_target_seconds,
      qcPassedAt: new Date().toISOString()
    });
  }
  return storedArtifact;
}

async function enqueueNext(episode, stage) {
  const index = STAGES.indexOf(stage);
  if (index < 0 || index >= STAGES.length - 1) return null;
  const next = STAGES[index + 1];
  const jobs = buildEpisodeProductionJobs(episode);
  const template = jobs.find(job => job.type === `teevee.episode.${next}`);
  if (!template) return null;
  const result = await teeveeStore.enqueue({
    id: randomUUID(),
    type: template.type,
    payload: template.payload,
    maxAttempts: 8,
    dedupeKey: template.dedupeKey,
    priority: template.priority
  });
  return result.duplicate ? null : next;
}

async function fetchWithRetry(url,options={},label="provider"){
  let lastError;
  for(let attempt=1;attempt<=5;attempt++){
    try{
      const response=await fetch(url,options);
      if(response.ok) return response;
      if(![408,425,429,500,502,503,504].includes(response.status)) return response;
      const retryAfter=Number(response.headers.get("retry-after")||0);
      const delay=Math.min(30000,retryAfter>0?retryAfter*1000:500*2**(attempt-1)+Math.floor(Math.random()*250));
      if(attempt<5) await new Promise(resolve=>setTimeout(resolve,delay));
      lastError=new Error(`${label} returned ${response.status}`);
    }catch(error){
      lastError=error;
      if(attempt<5) await new Promise(resolve=>setTimeout(resolve,Math.min(30000,500*2**(attempt-1)+Math.floor(Math.random()*250))));
    }
  }
  throw lastError||new Error(`${label} request failed`);
}

async function generateText(prompt){
  const providers=[
    ["OPENROUTER_API_KEY","https://openrouter.ai/api/v1/chat/completions",process.env.OPENROUTER_MODEL||"openai/gpt-5-mini"],
    ["GROQ_API_KEY","https://api.groq.com/openai/v1/chat/completions",process.env.GROQ_MODEL||"llama-3.3-70b-versatile"],
    ["OPENAI_API_KEY","https://api.openai.com/v1/chat/completions",process.env.OPENAI_MODEL||"gpt-5.6"]
  ];
  const failures=[];
  for(const [key,url,model] of providers){
    if(!process.env[key]) continue;
    try{
      const r=await fetchWithRetry(url,{method:"POST",headers:{"Authorization":`Bearer ${process.env[key]}`,"Content-Type":"application/json"},body:JSON.stringify({
        model,messages:[{role:"system",content:"You are the TeeVee original-animation writers room. Create original material only. Do not imitate living artists. Return production-ready text, concise and concrete."},{role:"user",content:prompt}],temperature:.8
      })});
      if(!r.ok){ failures.push(`${key}: HTTP ${r.status}`); continue; }
      const data=await r.json(); const text=data?.choices?.[0]?.message?.content;
      if(text) return {text,provider:key};
      failures.push(`${key}: empty response`);
    }catch(error){ failures.push(`${key}: ${error?.message || error}`); }
  }
  throw new Error(failures.length ? `All configured text providers failed: ${failures.join("; ")}` : "No configured text-generation provider");
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
  if(!process.env.HF_TOKEN) throw new Error("HF_TOKEN is required for TeeVee voice generation");
  const model=process.env.HF_TTS_MODEL||"espnet/kan-bayashi_ljspeech_vits";
  const r=await fetchWithRetry(`https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`,{
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

function concatQuote(file){
  return "file '"+file.replace(/'/g,"'\\''")+"'";
}

async function concatAnimation(sceneFiles, output, runtimeSeconds){
  const dir=path.dirname(output);
  await fs.mkdir(dir,{recursive:true});
  const list=path.join(dir,"concat.txt");
  await fs.writeFile(list,sceneFiles.map(concatQuote).join("\n")+"\n");
  try{
    await new Promise((resolve,reject)=>ffmpeg()
      .input(list)
      .inputOptions(["-f","concat","-safe","0"])
      .outputOptions(["-an","-c:v","libx264","-preset","medium","-pix_fmt","yuv420p","-t",String(runtimeSeconds),"-movflags","+faststart"])
      .save(output).on("end",resolve).on("error",reject));
  }finally{
    await fs.rm(list,{force:true});
  }
  const stat=await fs.stat(output).catch(()=>null);
  if(!stat || stat.size<=0) throw new Error("Animation assembly produced an empty artifact");
  return output;
}

async function media(kind,prompt,output){
  if(!process.env.POLLINATIONS_API_KEY) throw new Error("POLLINATIONS_API_KEY is required for TeeVee "+kind+" generation");
  const base=kind==="video"?"https://gen.pollinations.ai/video/":"https://gen.pollinations.ai/image/";
  const model=kind==="video"?(process.env.POLLINATIONS_VIDEO_MODEL||"alibaba/wan-2.2-fast"):(process.env.POLLINATIONS_IMAGE_MODEL||"flux");
  const params=kind==="video"?new URLSearchParams({model,duration:"6",aspectRatio:"16:9"}):new URLSearchParams({model,width:"1280",height:"720",nologo:"true"});
  const r=await fetchWithRetry(base+encodeURIComponent(prompt)+"?"+params,{headers:{Authorization:`Bearer ${process.env.POLLINATIONS_API_KEY}`}},"Pollinations "+kind);
  if(!r.ok) throw new Error(`Pollinations ${kind} returned ${r.status}`);
  const buf=Buffer.from(await r.arrayBuffer()); if(!buf.length) throw new Error("Empty media response");
  await fs.mkdir(path.dirname(output),{recursive:true}); await fs.writeFile(output,buf); return output;
}

async function handle(stage, job){
  const p=job.payload||job; const episode=await getEpisode(p.episodeId); await restoreEpisodeArtifacts(episode); const code=episode.episode_code;
  const base=`TeeVee original animated entertainment network. Episode ${code}. Title: ${episode.title}. Lane: ${episode.audience_lane}. Runtime target: ${episode.runtime_target_seconds}s. Visual DNA: dark fantasy anime, sharp cel shading, high-contrast cinematic lighting, highly detailed. Make it original, entertaining, memorable, and suitable for its stated maturity lane.`;
  let file, metadata={provider:"deterministic"};
  if(stage==="story"){
    const generated=await generateText(`${base}
Create the story bible for this episode: premise, protagonist, supporting cast, world rules, conflict, escalation, reversal, climax, emotional payoff, and a 30-second opening hook. Avoid existing franchises.`);
    metadata.provider=generated.provider;
    file=await writeText(code,stage,"story.md",generated.text);
  }else if(stage==="script"){
    const story=await fs.readFile(path.join(stagePath(code,"story"),"story.md"),"utf8");
    const generated=await generateText(`${base}
Here is the story development for ${code}:
${story.slice(0,24000)}

Turn it into a filmable script with scene headings, action, dialogue, sound cues, and a compelling first 30 seconds. Target the episode runtime and keep it original.`);
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
    const script=await fs.readFile(path.join(stagePath(code,"script"),"script.md"),"utf8");
    file=await tts(script.slice(0,60000),path.join(stagePath(code,stage),"narration.wav"));
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
  }else if(stage==="inspection"){
    const master=path.join(stagePath(code,"master"),code+".mp4");
    const stat=await fs.stat(master).catch(()=>null);
    if(!stat || stat.size<=0) throw new Error("King Cob inspection requires a non-empty master artifact");
    const evidence=[
      {type:"asset",artifact:artifactKey(code,"master",master)},
      {type:"review",artifact:artifactKey(code,"qc",path.join(stagePath(code,"qc"),"qc.json"))},
      {type:"inspection",authority:"king_cob"}
    ];
    file=await writeJson(code,stage,"inspection.json",{episode:code,authority:"king_cob",result:"approved",evidence,inspectedAt:new Date().toISOString()});
    metadata.authority="king_cob";
    metadata.result="approved";
  }else if(stage==="catalog"){
    file=await writeJson(code,stage,"catalog.json",{episode:code,status:"catalog-ready",master:`master/${code}.mp4`});
  }else if(stage==="schedule"){
    file=await writeJson(code,stage,"schedule.json",{episode:code,block:"TeeVee Toonhouse",status:"scheduled"});
  }
  const artifact = await advance(episode,stage,file,metadata);
  await enqueueNext(episode,stage);
  return {status:"ok",episodeCode:code,stage,artifact};
}

export const handlers=Object.fromEntries(STAGES.map(stage=>[`teevee.episode.${stage}`,job=>handle(stage,job)]));
export default handlers;
