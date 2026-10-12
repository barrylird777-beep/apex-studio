import test from "node:test";
import assert from "node:assert/strict";
import { RenderQueue } from "../src/core/render.mjs";

test("render queue creates a portable manifest",async()=>{
  const q=new RenderQueue();
  const job=q.enqueue({sceneId:"scene_1",shotIds:["shot_1"],format:"youtube-1080p"});
  const manifest=await q.writeManifest(job,[{id:"scene_1",shots:[{id:"shot_1",duration:4},{id:"shot_2",duration:2}]}],"./data/runtime/test-renders");
  assert.equal(manifest.shots.length,1);
  assert.equal(q.get(job.id).status,"prepared");
});
