import test from "node:test";
import assert from "node:assert/strict";
import { parseProsody } from "../src/core/prosody.mjs";
import { monoCompatibleWidth } from "../src/core/stereo.mjs";
import { inspectUntrusted } from "../src/core/omni-sanitize.mjs";
import { detectOmniTrigger, isProtocolOffSwitch, buildRiskReport } from "../src/core/omni-risk.mjs";
import { EgressPolicy } from "../src/core/egress.mjs";
import { OmniStore } from "../src/core/omni-store.mjs";
import { SexEngine } from "../src/core/se-x.mjs";

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

test("protocol off-switch is registered as NILLY-WILLY and disables the OMNI trigger for that exact command",()=>{
  assert.equal(isProtocolOffSwitch("NILLY-WILLY"),true);
  assert.equal(isProtocolOffSwitch("NILLY-WILLY "),true);
  assert.equal(isProtocolOffSwitch("NILLY-WILLYX"),false);
  assert.equal(detectOmniTrigger("NILLY-WILLY"),false);
});

test("trigger selects review mode but does not change safety policy",()=>{
  assert.equal(detectOmniTrigger("test [WILLY-NILLY]"),true);
  const r=buildRiskReport({query:"[WILLY-NILLY]",sources:["https://example.org"]});
  assert.equal(r.mode,"STANDARD");
  assert.equal(r.network.telemetry,"disabled");
  assert.equal(r.process.dynamicCodeExecution,false);
});

test("egress requires an explicit allowlist when requested",async()=>{
  const egress=new EgressPolicy({
    allowedHosts:["example.org"],
    requireAllowlist:true,
    resolve:async()=>[{address:"93.184.216.34"}]
  });
  await assert.doesNotReject(()=>egress.check("https://example.org/research"));
  await assert.rejects(()=>egress.check("https://evil.example/research"));
  await assert.rejects(()=>egress.check("https://example.org@evil.example/research"));
  await assert.doesNotReject(()=>egress.check("http://example.org/research"));
});

test("egress rejects private address resolution",async()=>{
  await assert.rejects(
    ()=>new EgressPolicy({
      allowedHosts:["example.org"],
      requireAllowlist:true,
      resolve:async()=>[{address:"127.0.0.1"}]
    }).check("https://example.org")
  );
});

test("SE-X requires the risk handshake and HTTPS allowlisted destinations",async()=>{
  const events=[];
  const egress=new EgressPolicy({
    allowedHosts:["example.org"],
    resolve:async()=>[{address:"93.184.216.34"}]
  });
  const sex=new SexEngine({
    egress,
    events:{emit:(name,payload)=>events.push([name,payload])}
  });
  await assert.rejects(
    ()=>sex.search("research",{sources:["https://example.org"],approved:false}),
    /Approved risk handshake/
  );
  assert.equal(events[0][0],"sex.started");
});

test("SE-X rejects non-HTTPS sources before network access",async()=>{
  const egress=new EgressPolicy({
    allowedHosts:["example.org"],
    resolve:async()=>[{address:"93.184.216.34"}]
  });
  const sex=new SexEngine({egress});
  const run=await sex.search("research",{sources:["http://example.org"],approved:true});
  assert.match(run.results[0].error,/protocol is not permitted/);
});

test("OMNI persistence uses relational SQLite timeline tables",async()=>{
  const db="./apex-omni-test-"+Date.now()+"-"+Math.random().toString(16).slice(2)+".sqlite";
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
