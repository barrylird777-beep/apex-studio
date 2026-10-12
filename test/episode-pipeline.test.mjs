import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { produceKernelVisionEpisode } from "../src/video/episode-pipeline.mjs";

async function fixture(){
  const root=await mkdtemp(path.join(tmpdir(),"kernelvision-episode-"));
  await mkdir(path.join(root,"assets"),{recursive:true});
  const shots=[];
  const motions=["zoom_in","zoom_out","pan_left","pan_right"];
  for(let i=0;i<10;i++){
    const image=path.join("assets",`shot-${i}.png`);
    await writeFile(path.join(root,image),Buffer.from("image-"+i));
    shots.push({id:"shot-"+i,image,durationSec:3,motion:motions[i%motions.length],visual:"Joseph stands in a moonlit desert scene "+i,narration:i===0?"His brothers wanted him gone.":"Joseph faces the next trial, scene "+i+".",labels:["dramatization"],sources:["Genesis 37:1"],provenance:{classification:"generated",source:"test fixture"}});
  }
  await writeFile(path.join(root,"assets","narration.wav"),Buffer.from("narration"));
  return {root,shots,narrationPath:"assets/narration.wav"};
}
const probe={width:1920,height:1080,vcodec:"h264",pixFmt:"yuv420p",acodec:"aac",fps:24,durationSec:30};
const qc={ok:true,checks:{hasVideo:true,hasAudio:true,dimensions:true,aspectRatio:true,duration:true,playable:true},failures:[],duration:30,streams:[]};
function fakeOptions(records){
  return {
    assemble:async({outPath})=>{await writeFile(outPath,Buffer.from("verified-test-video"));const srtPath=outPath.replace(/\.mp4$/,".srt");await writeFile(srtPath,"1\n00:00:00,000 --> 00:00:03,000\nHook\n");return{outPath,srtPath,durationSec:30};},
    probe:async()=>({...probe}),
    probeAudio:async()=>({durationSec:30}),
    qc:async()=>({...qc}),
    fabric:{put:async(appId,id,record)=>{records.push({appId,id,record});return record;}}
  };
}

test("episode export validates hook, assembles media, QC-checks and stores metadata without SQL",async()=>{
  const f=await fixture(),records=[];
  try{
    const result=await produceKernelVisionEpisode({projectId:"joseph",episodeId:"genesis-37",title:"Joseph: The Pit",contentDomain:"bible",passage:"Genesis 37:1-11",shots:f.shots,narrationPath:f.narrationPath,narrationProvenance:{classification:"licensed",source:"test voiceover",licenseRef:"permission-123"}},{mediaRoot:f.root,...fakeOptions(records)});
    assert.equal(result.success,true);
    assert.equal(result.artifact.status,"ready");
    assert.equal(result.artifact.output.width,1920);
    assert.equal(result.artifact.openingHook.durationSec,30);
    assert.equal(result.artifact.releaseEligible,false,"rendering alone must never publish an episode");
    assert.equal(result.artifact.provenanceReady,true);
    assert.ok(result.artifact.releaseBlockers.includes("human-release-approval-required"));
    assert.equal(records.length,1);
    assert.equal(records[0].appId,"kernel-vision");
    assert.match(records[0].id,/^episode-genesis-37-/);
    assert.match(result.artifact.output.sha256,/^[a-f0-9]{64}$/);
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test("episode export rejects paths that escape the managed media root",async()=>{
  const f=await fixture(),records=[];
  try{
    f.shots[0].image="../outside.png";
    await assert.rejects(()=>produceKernelVisionEpisode({projectId:"p",episodeId:"escape",shots:f.shots,narrationPath:f.narrationPath},{mediaRoot:f.root,...fakeOptions(records)}),/escapes the media root/);
    assert.equal(records.length,0);
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test("episode export refuses an invalid retention hook before rendering",async()=>{
  const f=await fixture(),records=[];
  try{
    f.shots[0].narration="Welcome to this video about Joseph";
    let rendered=false;
    const options={...fakeOptions(records),assemble:async()=>{rendered=true;throw new Error("should not render");}};
    await assert.rejects(()=>produceKernelVisionEpisode({projectId:"p",episodeId:"bad-hook",shots:f.shots,narrationPath:f.narrationPath},{mediaRoot:f.root,...options}),error=>error.code==="HOOK_VALIDATION_FAILED");
    assert.equal(rendered,false);
    assert.equal(records.length,0);
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test("unverified media can render for review but cannot be marked release-eligible",async()=>{
  const f=await fixture(),records=[];
  try{
    f.shots[0].provenance={classification:"unverified",source:"unknown upload"};
    const result=await produceKernelVisionEpisode({projectId:"p",episodeId:"unverified",shots:f.shots,narrationPath:f.narrationPath},{mediaRoot:f.root,...fakeOptions(records)});
    assert.equal(result.artifact.status,"ready");
    assert.equal(result.artifact.releaseEligible,false);
  }finally{await rm(f.root,{recursive:true,force:true});}
});


test("episode export records QC failures as non-publishable artifacts",async()=>{
  const f=await fixture(),records=[];
  try{
    const options={...fakeOptions(records),qc:async()=>({ok:false,failures:["dimensions"]})};
    await assert.rejects(()=>produceKernelVisionEpisode({projectId:"p",episodeId:"qc-fail",shots:f.shots,narrationPath:f.narrationPath},{mediaRoot:f.root,...options}),/Episode export failed QC/);
    assert.equal(records.length,1);
    assert.equal(records[0].record.status,"qc-failed");
    assert.equal(records[0].record.releaseEligible,false);
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test("episode export rejects narration shorter than the timeline before rendering",async()=>{
  const f=await fixture(),records=[];
  try{
    let rendered=false;
    const options={...fakeOptions(records),probeAudio:async()=>({durationSec:18}),assemble:async()=>{rendered=true;throw new Error("must not render");}};
    await assert.rejects(
      ()=>produceKernelVisionEpisode({projectId:"p",episodeId:"short-narration",shots:f.shots,narrationPath:f.narrationPath},{mediaRoot:f.root,...options}),
      error=>error.code==="NARRATION_DURATION_MISMATCH"
    );
    assert.equal(rendered,false);
    assert.equal(records.length,1);
    assert.equal(records[0].record.status,"preflight-failed");
    assert.equal(records[0].record.audioTiming.narrationDurationSec,18);
    assert.equal(records[0].record.releaseEligible,false);
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test("audio probe rejects an unmeasurable narration duration",async()=>{
  const f=await fixture(),records=[];
  try{
    const options={...fakeOptions(records),probeAudio:async()=>{throw Object.assign(new Error("ffprobe failed"),{code:"NARRATION_DURATION_UNVERIFIED"});}};
    await assert.rejects(
      ()=>produceKernelVisionEpisode({projectId:"p",episodeId:"unmeasurable-audio",shots:f.shots,narrationPath:f.narrationPath},{mediaRoot:f.root,...options}),
      error=>error.code==="NARRATION_DURATION_UNVERIFIED"
    );
    assert.equal(records.length,1);
    assert.equal(records[0].record.status,"preflight-failed");
    assert.equal(records[0].record.releaseEligible,false);
  }finally{await rm(f.root,{recursive:true,force:true});}
});
