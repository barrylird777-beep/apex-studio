import test from "node:test";
import assert from "node:assert/strict";
import { buildStoryboard } from "../src/core/storyboard.mjs";
import { buildFfmpegPlan } from "../src/core/ffmpeg.mjs";

test("storyboard creates shots from scene beats",()=>{
 const shots=buildStoryboard({id:"scene_1",title:"Creation",beats:[{id:"b1",title:"Light",description:"Light appears",order:0}],characters:["c1"],locationId:"l1",continuityRefs:["c1"],sourceRefs:[{sourceId:"s1",locator:"Genesis 1:3"}]});
 assert.equal(shots.length,1);
 assert.equal(shots[0].sourceRefs[0].sourceId,"s1");
});

test("ffmpeg plan stays explicit when media is missing",()=>{
 const plan=buildFfmpegPlan({format:"youtube-1080p"});
 assert.equal(plan.ready,false);
 assert.match(plan.reason,/visual media/);
});
