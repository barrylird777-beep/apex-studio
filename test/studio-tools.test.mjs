import test from "node:test";
import assert from "node:assert/strict";
import { analyzeScript, auditShotList, buildPromptPack, buildSubtitles, deliveryPreset, safeAssetFilename, secondsToTimecode, timecodeToSeconds, productionChecklist } from "../src/core/studio-tools.mjs";

test("studio tools convert timecode",()=>{
  assert.equal(secondsToTimecode(65.5,24),"00:01:05:12");
  assert.equal(timecodeToSeconds("00:01:05:12",24),65.5);
});

test("studio tools build subtitles",()=>{
  const s=buildSubtitles([{start:0,end:2,text:"In the beginning."}],{format:"srt"});
  assert.match(s.content,/00:00:00,000 --> 00:00:02,000/);
  assert.match(s.content,/In the beginning/);
});

test("studio tools analyze scripts and audit shots",()=>{
  assert.equal(analyzeScript("One two three",{}).words,3);
  const audit=auditShotList([{type:"wide",duration:4,visualPrompt:"mountain",sourceRefs:[{id:"x"}]},{type:"close",duration:3,visualPrompt:"face",sourceRefs:[{id:"x"}]}]);
  assert.equal(audit.ready,true);
});

test("studio tools produce delivery and safe filenames",()=>{
  assert.deepEqual(deliveryPreset("vertical").width,1080);
  assert.equal(safeAssetFilename({project:"My Show",episode:"Ep 1",scene:"Scene/2",kind:"Master Video",ext:"mp4"}),"my-show_ep-1_scene-2_master-video.mp4");
});

test("studio tools build prompt packs and production checklist",()=>{
  const p=buildPromptPack({subject:"Moses at the sea",location:"shore",characters:["Moses"],camera:"wide"});
  assert.match(p.visualPrompt,/Moses at the sea/);
  assert.match(p.negativePrompt,/CGI/);
  assert.equal(productionChecklist({source:"x",script:"x",scenes:[1],storyboard:[1],visuals:true,audio:true,timeline:true,releasePackage:true}).ready,true);
});
