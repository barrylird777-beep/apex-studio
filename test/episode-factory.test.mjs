import test from "node:test";
import assert from "node:assert/strict";
import { createEpisode, episodeReadiness, episodeStageGate } from "../src/core/episode-factory.mjs";
import { auditEntertainment } from "../src/core/entertainment.mjs";
import { buildTruthGraphFromEpisode, addClaim, auditTruthGraph } from "../src/core/truth-graph.mjs";
import { episodeQualityGate } from "../src/core/quality-gates.mjs";
import { compileEpisode } from "../src/core/episode-compiler.mjs";

test("episode readiness requires real production assets",()=>{
  const episode=createEpisode({title:"David and Goliath",passage:"1 Samuel 17",sourceRefs:["1 Samuel 17"]});
  const readiness=episodeReadiness(episode);
  assert.equal(readiness.ready,false);
  assert.ok(readiness.missing.includes("hook"));
  assert.ok(readiness.missing.includes("visuals"));
  assert.ok(readiness.missing.includes("audio"));
  assert.ok(readiness.missing.includes("entertainment"));
});

test("episode stages cannot skip unfinished prerequisites",()=>{
  const episode=createEpisode({title:"David and Goliath",sourceRefs:["1 Samuel 17"]});
  const gate=episodeStageGate(episode,"script");
  assert.equal(gate.ok,false);
  assert.deepEqual(gate.blockers,["hook","story"]);
});

test("truth graph enforces Scripture source provenance",()=>{
  const episode=createEpisode({title:"David and Goliath",sourceRefs:["1 Samuel 17"]});
  const graph=buildTruthGraphFromEpisode(episode);
  const claim=addClaim(graph,{text:"A source-backed event",type:"event",provenance:"scripture",sourceRefs:["1 Samuel 17"]});
  assert.ok(claim.id);
  assert.equal(auditTruthGraph(graph).ready,true);
});

test("quality gate blocks incomplete production without subjective scoring",()=>{
  const episode=createEpisode({title:"David and Goliath",sourceRefs:["1 Samuel 17"]});
  const gate=episodeQualityGate(episode);
  assert.equal(gate.ready,false);
  assert.ok(gate.blockers.length>0);
  assert.equal("score" in gate,false);
});

test("compiler creates a truth graph and quality-gate report",()=>{
  const episode=compileEpisode({title:"David and Goliath",passage:"1 Samuel 17",sourceRefs:["1 Samuel 17"]});
  assert.ok(episode.compiler);
  assert.ok(episode.truthGraph);
  assert.ok(episode.qualityGate);
  assert.equal(episode.stage,"source");
});

test("entertainment audit detects pacing",()=>{
  const audit=auditEntertainment({
    title:"David and Goliath", passage:"1 Samuel 17", sourceRefs:["1 Samuel 17"],
    hook:{prompt:"A giant approaches. What happens next? A question and mystery."},
    storySummary:"Danger and stakes rise. Fear turns to hope as the battle begins.",
    storyboard:[{duration:2},{duration:6},{duration:3}], audio:[{type:"music"}],
    scenes:[{description:"battle"}]
  });
  assert.equal(audit.checks.find(x=>x.name==="pacing_variation").ok,true);
});
