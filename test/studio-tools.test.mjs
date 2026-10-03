import test from "node:test";
import assert from "node:assert/strict";
import { analyzeScript, buildSubtitles, deliveryPreset, safeAssetFilename, secondsToTimecode, timecodeToSeconds, productionChecklist } from "../src/core/studio-tools.mjs";

test("studio tools convert timecode",()=>{
  assert.equal(secondsToTimecode(65.5,24),"00:01:05:12");
  assert.equal(timecodeToSeconds("00:01:05:12",24),65.5);
});

test("studio tools build subtitles",()=>{
  const s=buildSubtitles([{start:0,end:2,text:"Production ready."}],{format:"srt"});
  assert.match(s.content,/00:00:00,000 --> 00:00:02,000/);
  assert.match(s.content,/Production ready/);
});

test("studio tools analyze scripts",()=>{
  assert.equal(analyzeScript("One two three",{}).words,3);
});

test("studio tools produce delivery and safe filenames",()=>{
  assert.equal(deliveryPreset("vertical").width,1080);
  assert.equal(safeAssetFilename({project:"Apex Studio",batch:"batch 1",kind:"Master Video",ext:"mp4"}),"apex-studio_batch-1_master-video.mp4");
});

test("studio tools validate production readiness",()=>{
  assert.equal(productionChecklist({source:"x",script:"x",media:[1],audio:true,timeline:true,releasePackage:true}).ready,true);
});
