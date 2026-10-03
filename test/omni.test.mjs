import test from "node:test";
import assert from "node:assert/strict";
import { parseProsody } from "../src/core/prosody.mjs";
import { monoCompatibleWidth } from "../src/core/stereo.mjs";
import { inspectUntrusted } from "../src/core/omni-sanitize.mjs";
import { detectOmniTrigger, buildRiskReport } from "../src/core/omni-risk.mjs";
import { createNarrativeTrack, mapNarrativeBlock } from "../src/core/narrative-map.mjs";
import { EgressPolicy } from "../src/core/egress.mjs";
import { OmniStore } from "../src/core/omni-store.mjs";
import fs from "node:fs/promises";

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

test("trigger selects review mode but does not change safety policy",()=>{
  assert.equal(detectOmniTrigger("test [WILLY-NILLY]"),true);
  const r=buildRiskReport({query:"[WILLY-NILLY]",sources:["https://example.org"]});
  assert.equal(r.mode,"ELEVATED_REVIEW");
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

test("OMNI persistence stores raw structured JSONL without encryption framing",async()=>{
  const root="./data/omni/test-"+Date.now();
  const store=new OmniStore(root);
  await store.append("search_results",{id:"r1",text:"research",status:200});
  const raw=await fs.readFile(root+"/search_results.jsonl","utf8");
  assert.match(raw,/{"id":"r1"/);
  assert.deepEqual(await store.list("search_results"),[{id:"r1",text:"research",status:200}]);
});
