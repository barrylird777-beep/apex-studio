import test from "node:test";
import assert from "node:assert/strict";
import { createEpisode, episodeReadiness } from "../src/core/episode-factory.mjs";
import { auditEntertainment } from "../src/core/entertainment.mjs";

test("episode readiness requires real production assets",()=>{
  const episode=createEpisode({title:"David and Goliath",passage:"1 Samuel 17",sourceRefs:["1 Samuel 17"]});
  const readiness=episodeReadiness(episode);
  assert.equal(readiness.ready,false);
  assert.ok(readiness.missing.includes("hook"));
  assert.ok(readiness.missing.includes("visuals"));
  assert.ok(readiness.missing.includes("audio"));
  assert.ok(readiness.missing.includes("entertainment"));
});

test("entertainment audit detects pacing and story signals",()=>{
  const audit=auditEntertainment({
    title:"David and Goliath",
    passage:"1 Samuel 17",
    sourceRefs:["1 Samuel 17"],
    hook:{prompt:"A giant approaches. What happens next? A question and mystery."},
    storySummary:"Danger and stakes rise. Fear turns to hope as the battle begins.",
    storyboard:[{duration:2},{duration:6},{duration:3}],
    audio:[{type:"music"}],
    scenes:[{description:"battle"}]
  });
  assert.equal(audit.ready,true);
  assert.equal(audit.checks.find(x=>x.name==="pacing_variation").ok,true);
});
