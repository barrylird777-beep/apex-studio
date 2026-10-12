import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { produceKernelVisionEpisode } from "../src/video/episode-pipeline.mjs";

const exec=promisify(execFile);
const root=await mkdtemp(path.join(tmpdir(),"kernelvision-export-smoke-"));
const records=[];
const fabric={async put(appId,id,record){records.push({appId,id,record});return record;}};
const colors=["#171321","#2c1837","#4a2634","#273b50","#4d3c2a","#1d3a36","#3d263e","#253044","#5a302b","#1e3447"];
const motions=["zoom_in","zoom_out","pan_left","pan_right"];
try{
  const assets=path.join(root,"assets");
  await mkdir(assets,{recursive:true});
  for(let i=0;i<colors.length;i++){
    await exec(process.env.FFMPEG_PATH||"ffmpeg",["-y","-hide_banner","-loglevel","error","-f","lavfi","-i",`color=c=${colors[i]}:s=1920x1080:r=1`,"-frames:v","1",path.join(assets,`shot-${i}.png`)]);
  }
  const narration=path.join(assets,"narration.wav");
  await exec(process.env.FFMPEG_PATH||"ffmpeg",["-y","-hide_banner","-loglevel","error","-f","lavfi","-i","sine=frequency=180:sample_rate=48000:duration=30","-ac","2","-c:a","pcm_s16le",narration]);
  const shots=colors.map((color,i)=>({
    id:"smoke-shot-"+i,image:`assets/shot-${i}.png`,durationSec:3,motion:motions[i%motions.length],
    visual:"Synthetic color-card placeholder for shot "+(i+1),
    narration:i===0?"His brothers wanted him gone.":"Synthetic narration placeholder for shot "+(i+1)+".",
    labels:["dramatization"],sources:["smoke-test:synthetic-media"],
    provenance:{classification:"unverified",source:"synthetic CI smoke fixture",notes:"Not for publication"}
  }));
  const result=await produceKernelVisionEpisode({
    projectId:"smoke-project",episodeId:"smoke-episode",title:"Synthetic Export Smoke Test",
    contentDomain:"original",shots,narrationPath:"assets/narration.wav",
    narrationProvenance:{classification:"unverified",source:"synthetic CI smoke fixture",notes:"Not for publication"}
  },{mediaRoot:root,fabric});
  const output=path.join(root,result.artifact.output.path);
  const info=await stat(output);
  assert.ok(info.size>10000,"rendered MP4 must contain actual media bytes");
  assert.equal(result.artifact.status,"ready");
  assert.equal(result.artifact.output.width,1920);
  assert.equal(result.artifact.output.height,1080);
  assert.equal(result.artifact.output.vcodec,"h264");
  assert.equal(result.artifact.output.acodec,"aac");
  assert.ok(Math.abs(result.artifact.output.fps-24)<0.01,"rendered MP4 must be 24 fps");
  assert.ok(Math.abs(result.artifact.output.durationSec-30)<0.75);
  assert.equal(result.artifact.releaseEligible,false,"synthetic smoke media must never be publication-eligible");
  assert.equal(records.length,1);
  console.log(JSON.stringify({success:true,synthetic:true,notForPublication:true,bytes:info.size,output:result.artifact.output.path,sha256:result.artifact.output.sha256,durationSec:result.artifact.output.durationSec,fps:result.artifact.output.fps,qc:result.artifact.quality},null,2));
}catch(error){
  console.error("[kernelvision-episode-smoke] failed:",error?.stack||error);
  process.exitCode=1;
}finally{
  await rm(root,{recursive:true,force:true});
}
