import test from "node:test";
import assert from "node:assert/strict";
import { parseProsody } from "../src/core/prosody.mjs";
import { monoCompatibleWidth } from "../src/core/stereo.mjs";
import { inspectUntrusted } from "../src/core/omni-sanitize.mjs";
import { buildRiskReport } from "../src/core/omni-risk.mjs";
import { createNarrativeTrack, mapNarrativeBlock } from "../src/core/narrative-map.mjs";
import { EgressPolicy } from "../src/core/egress.mjs";
import { OmniStore } from "../src/core/omni-store.mjs";

test("prosody parser preserves plain speech and extracts supported tags",()=>{
  const x=parseProsody("[emotion=urgent][pace=fast]Open the gate.");
  assert.equal(x.text,"Open the gate.");
  assert.deepEqual(x.tags,[{key:"emotion",value:"urgent"},{key:"pace",value:"fast"}]);
});

test("stereo widening uses a mono-safe mid-side representation",()=>{
  const x=monoCompatibleWidth({width:.8});
  assert.equal(x.monoSafe,true);
  assert.equal(x.algorithm,"mid-side");
  assert.ok(x.leftGain>0&&x.rightGain>0);
});

test("untrusted content is inspected without executing it",()=>{
  const x=inspectUntrusted('<script>fetch("https://evil")</script> hello');
  assert.equal(x.suspicious,true);
  assert.equal(x.safeText.includes("fetch"),false);
});

test("risk report preserves safety policy without special trigger modes",()=>{
  const r=buildRiskReport({query:"ordinary research",sources:["https://example.org"]});
  assert.equal(r.mode,"STANDARD");
  assert.equal(r.network.telemetry,"disabled");
  assert.equal(r.process.dynamicCodeExecution,false);
});

test("narrative blocks map directly to visual frame ranges",()=>{
  const track=createNarrativeTrack({title:"Branch A",branchId:"a"});
  mapNarrativeBlock(track,{text:"Run.",visualFrames:{start:12,end:36},vocal:{emotion:"urgent"}});
  assert.equal(track.blocks[0].visualFrames.start,12);
  assert.equal(track.blocks[0].vocal.emotion,"urgent");
});

test("egress has no hostname allowlist but rejects non-public targets",async()=>{
  const egress=new EgressPolicy({resolve:async()=>[{address:"93.184.216.34"}]});
  await assert.doesNotReject(()=>egress.check("https://example.org/research"));
  await assert.rejects(()=>new EgressPolicy({resolve:async()=>[{address:"127.0.0.1"}]}).check("http://example.org"));
});

test("OMNI persistence uses relational SQLite timeline tables",async()=>{
  const db="./apex-omni-test-"+Date.now()+".sqlite";
  const store=new OmniStore(db);
  const node=await store.createProductionTimeline({
    nodeId:"node-1", sceneLabel:"Opening", timecode:"00:00:12:00",
    aestheticProfile:"mature-shonen", prompt:"Hero enters the city.",
    audioTags:["breath","impact"]
  });
  assert.equal(node.nodeId,"node-1");
  assert.deepEqual(node.audioTags,["breath","impact"]);
  const mutation=await store.createTimelineMutation({
    parentNodeId:"node-1", branchId:"branch-a",
    alteredVisual:[{shot:"wide"}], alteredVocal:[{emotion:"urgent"}]
  });
  assert.equal(mutation.parentNodeId,"node-1");
  assert.deepEqual(mutation.alteredVisual,[{shot:"wide"}]);
  assert.deepEqual(mutation.alteredVocal,[{emotion:"urgent"}]);
  assert.equal((await store.listProductionTimelines()).length,1);
  assert.equal((await store.listTimelineMutations("node-1")).length,1);
  await store.close();
});
