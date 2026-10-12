import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { assembleVideo, probeVideo, checkSpec } from "./assemble.mjs";
import { validateHookPlan, LABELS, MOTIONS } from "./hook.mjs";
import { runRenderQC } from "../core/validation/render-qc.mjs";
import { sovereignAppFabric } from "../core/sovereign-app-fabric.mjs";

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,100}$/;
const CLASSES=new Set(["generated","imported","licensed","unverified"]);
const DEFAULT_MEDIA_ROOT=process.env.APEX_KERNELVISION_MEDIA_ROOT||process.env.STORAGE_DIR||path.resolve("data/runtime/storage");
const inside=(root,target)=>{const rel=path.relative(root,target);return rel!==""&&!rel.startsWith(".."+path.sep)&&rel!==".."&&!path.isAbsolute(rel);};
const safeId=(value,label)=>{const id=String(value??"").trim();if(!ID.test(id)||id.includes(".."))throw new TypeError(label+" is invalid");return id;};
const safeText=(value,max=2000)=>String(value??"").trim().slice(0,max);

async function resolveMediaFile(root,relative,label){
  if(typeof relative!=="string"||!relative.trim()||path.isAbsolute(relative))throw new TypeError(label+" must be a relative media path");
  const candidate=path.resolve(root,relative);
  if(!inside(root,candidate))throw new Error(label+" escapes the media root");
  const actual=await realpath(candidate);
  if(!inside(root,actual))throw new Error(label+" resolves outside the media root");
  const info=await stat(actual);
  if(!info.isFile())throw new Error(label+" must be a regular file");
  await access(actual);
  return actual;
}
async function sha256File(file){
  const hash=crypto.createHash("sha256");
  await new Promise((resolve,reject)=>{const stream=createReadStream(file);stream.on("data",chunk=>hash.update(chunk));stream.once("error",reject);stream.once("end",resolve);});
  return hash.digest("hex");
}
function normalizeProvenance(value,defaultSource){
  const input=value&&typeof value==="object"&&!Array.isArray(value)?value:{};
  const classification=CLASSES.has(input.classification)?input.classification:"unverified";
  return {
    classification,
    source:safeText(input.source,500)||defaultSource,
    licenseRef:safeText(input.licenseRef,1000)||null,
    notes:safeText(input.notes,1000)||null
  };
}
function provenanceComplete(p){
  if(!p?.source||/^unverified\b/i.test(p.source))return false;
  if(p.classification==="generated")return true;
  if(p.classification==="licensed"||p.classification==="imported")return Boolean(p.licenseRef);
  return false;
}

/**
 * Render an episode from already-generated/authorized local assets. This is
 * deliberately storage-agnostic at the media layer: media files stay separate
 * from Pure-WAL metadata, and no SQL database is opened by this pipeline.
 *
 * Input shot.image, narrationPath, and musicPath are relative to mediaRoot.
 * The first ten shots must form the 28-32 second retention hook.
 */
export async function produceKernelVisionEpisode(input={},options={}){
  if(!input||typeof input!=="object"||Array.isArray(input))throw new TypeError("Episode input must be an object");
  const projectId=safeId(input.projectId,"projectId");
  const episodeId=safeId(input.episodeId||crypto.randomUUID(),"episodeId");
  const title=safeText(input.title,240)||"Untitled cinematic episode";
  const contentDomain=["bible","korn","original"].includes(input.contentDomain)?input.contentDomain:"original";
  const passage=safeText(input.passage,500)||null;
  if(!Array.isArray(input.shots)||input.shots.length<10||input.shots.length>500)throw new TypeError("Episode requires 10-500 shots; the first ten form the opening hook");
  const mediaRoot=path.resolve(options.mediaRoot||DEFAULT_MEDIA_ROOT);
  await mkdir(mediaRoot,{recursive:true,mode:0o700});
  const root=await realpath(mediaRoot);
  const shots=[];
  for(let i=0;i<input.shots.length;i++){
    const source=input.shots[i];
    if(!source||typeof source!=="object"||Array.isArray(source))throw new TypeError("Shot "+i+" must be an object");
    const image=await resolveMediaFile(root,source.image,"Shot "+(i+1)+" image");
    const durationSec=Number(source.durationSec);
    if(!Number.isFinite(durationSec)||durationSec<0.25||durationSec>60)throw new TypeError("Shot "+(i+1)+" duration is invalid");
    const motion=String(source.motion||"");
    const visual=safeText(source.visual,2000);
    const narration=safeText(source.narration,2000);
    const labels=Array.isArray(source.labels)?source.labels.slice(0,8):[];
    const sources=Array.isArray(source.sources)?source.sources.map(x=>safeText(x,500)).filter(Boolean).slice(0,20):[];
    if(!MOTIONS.includes(motion))throw new TypeError("Shot "+(i+1)+" has an unsupported motion preset");
    if(!labels.length||!labels.every(label=>LABELS.includes(label)))throw new TypeError("Shot "+(i+1)+" labels must be a non-empty allowed subset");
    if(!visual||!narration||!sources.length)throw new TypeError("Shot "+(i+1)+" requires visual, narration, and source references");
    shots.push({
      id:safeId(source.id||"shot-"+(i+1),"shot id"),
      image,durationSec,motion,visual,narration,labels,sources,
      provenance:normalizeProvenance(source.provenance,"unverified shot media")
    });
  }
  const hook=validateHookPlan({narrationStartSec:0,shots:shots.slice(0,10).map(({id,durationSec,motion,visual,narration,labels,sources})=>({id,durationSec,motion,visual,narration,labels,sources}))});
  if(!hook.ok)throw Object.assign(new Error("Opening hook failed retention validation: "+hook.errors.join("; ")),{code:"HOOK_VALIDATION_FAILED",details:hook.errors});
  const narrationPath=await resolveMediaFile(root,input.narrationPath,"Narration asset");
  const narrationProvenance=normalizeProvenance(input.narrationProvenance,"unverified narration asset");
  let musicPath=null, musicProvenance=null;
  if(input.musicPath){musicPath=await resolveMediaFile(root,input.musicPath,"Music asset");musicProvenance=normalizeProvenance(input.musicProvenance,"unverified music asset");}
  const id=crypto.randomUUID();
  const exportDir=path.join(root,"kernelvision","exports");
  await mkdir(exportDir,{recursive:true,mode:0o700});
  const realExportDir=await realpath(exportDir);
  if(!inside(root,realExportDir))throw new Error("Export directory resolves outside the media root");
  const filename=episodeId+"-"+id+".mp4";
  const outPath=path.join(realExportDir,filename);
  const srtPath=outPath.replace(/\.mp4$/i,".srt");
  const totalDuration=shots.reduce((sum,shot)=>sum+shot.durationSec,0);
  const createdAt=new Date().toISOString();
  const mediaProvenance={
    shots:shots.map(shot=>({shotId:shot.id,durationSec:shot.durationSec,visual:shot.visual,labels:shot.labels,sourceRefs:shot.sources,...shot.provenance})),
    narration:narrationProvenance,
    music:musicProvenance
  };
  let renderResult,probe,qc,spec,artifact;
  try{
    renderResult=await (options.assemble||assembleVideo)({shots,narration:narrationPath,music:musicPath,outPath,fps:24,ffmpegPath:options.ffmpegPath||process.env.FFMPEG_PATH||"ffmpeg"});
    probe=await (options.probe||probeVideo)(outPath,{ffprobePath:options.ffprobePath||process.env.FFPROBE_PATH||"ffprobe"});
    spec=checkSpec(probe,{expectedSec:totalDuration,toleranceSec:0.75,expectedFps:24});
    qc=await (options.qc||runRenderQC)({mediaPath:outPath,expectedWidth:1920,expectedHeight:1080,expectedAspect:16/9,expectedDurationSeconds:totalDuration,toleranceSeconds:0.75});
    const qcPassed=spec.ok&&qc?.ok===true;
    const outputStat=await stat(outPath);
    artifact={
      id,projectId,episodeId,title,contentDomain,passage,
      status:qcPassed?"ready":"qc-failed",
      technicalReady:qcPassed,
      publicationState:qcPassed?"awaiting-human-approval":"blocked-qc",
      downloadPath:"/api/episodes/"+encodeURIComponent(episodeId)+"/"+encodeURIComponent(id)+"/download",
      output:{path:path.relative(root,outPath),subtitlePath:path.relative(root,renderResult.srtPath||srtPath),bytes:outputStat.size,sha256:await sha256File(outPath),format:"mp4",...probe},
      subtitles:{path:path.relative(root,renderResult.srtPath||srtPath),sha256:await sha256File(renderResult.srtPath||srtPath)},
      openingHook:{valid:hook.ok,durationSec:hook.totalSec,shotCount:10},
      mediaProvenance,
      provenance:{source:"KernelVision episode export pipeline",verified:qcPassed,verifiedAt:new Date().toISOString(),method:"FFprobe stream/spec validation plus render QC"},
      quality:{spec,qc},
      createdAt,completedAt:new Date().toISOString()
    };
    const provenanceItems=Object.values(mediaProvenance).flatMap(value=>Array.isArray(value)?value:[value]).filter(Boolean);
    artifact.provenanceReady=provenanceItems.every(provenanceComplete);
    artifact.releaseEligible=false; // Publishing requires a separate human approval tied to the exact artifact hash.
    artifact.releaseBlockers=[...(artifact.provenanceReady?[]:["media-provenance-incomplete"]),"human-release-approval-required"];
    artifact.publicationState="awaiting-human-approval";
    const fabric=options.fabric||sovereignAppFabric;
    await fabric.put("kernel-vision","episode-"+episodeId+"-"+id,artifact);
    if(!qcPassed)throw Object.assign(new Error("Episode export failed QC: "+[...(spec.errors||[]),...(qc?.failures||[])].join(", ")),{code:"RENDER_QC_FAILED",artifact});
    return {success:true,artifact,render:renderResult};
  }catch(error){
    if(!artifact){
      artifact={id,projectId,episodeId,title,contentDomain,passage,status:"render-failed",technicalReady:false,releaseEligible:false,publicationState:"blocked-render",releaseBlockers:["render-failed"],output:{path:path.relative(root,outPath)},openingHook:{valid:true,durationSec:hook.totalSec,shotCount:10},mediaProvenance,provenance:{source:"KernelVision episode export pipeline",verified:false},error:safeText(error?.message||error,2000),createdAt,completedAt:new Date().toISOString()};
      await (options.fabric||sovereignAppFabric).put("kernel-vision","episode-"+episodeId+"-"+id,artifact).catch(()=>{});
    }
    throw error;
  }
}
