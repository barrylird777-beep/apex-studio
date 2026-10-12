import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";

test("scene assets persist with media URLs and a hydrated project manifest",async()=>{
  const root=await mkdtemp(path.join(tmpdir(),"apex-scene-store-"));
  const previousRoot=process.env.APEX_TEST_STORAGE_DIR;
  const previousCI=process.env.CI;
  process.env.CI="true";
  process.env.APEX_TEST_STORAGE_DIR=root;
  try{
    const storage=await import("../src/core/storage.mjs?isolated="+crypto.randomUUID());
    const sceneId="scene_"+crypto.randomUUID().replace(/-/g,"");
    const video=await storage.saveSceneAsset(sceneId,"video",Buffer.from("synthetic-video-bytes"),"mp4");
    const audio=await storage.saveSceneAsset(sceneId,"audio",Buffer.from("synthetic-audio-bytes"),"wav");
    const manifest=await storage.getProjectState();
    const scene=manifest.scenes.find(item=>item.id===sceneId);
    assert.ok(scene,"scene must be present in the durable project manifest");
    assert.equal(scene.video,video.url);
    assert.equal(scene.audio,audio.url);
    assert.equal(scene.durationMs,4000);
    assert.match(scene.videoAsset.sha256,/^[a-f0-9]{64}$/);
    assert.match(scene.audioAsset.sha256,/^[a-f0-9]{64}$/);
    assert.equal(manifest.assets.filter(item=>item.sceneId===sceneId).length,2);
    for(const url of [video.url,audio.url]){
      const filename=decodeURIComponent(url.slice("/files/".length));
      await access(path.join(storage.STORAGE_DIR,filename));
    }
  }finally{
    if(previousRoot===undefined)delete process.env.APEX_TEST_STORAGE_DIR;else process.env.APEX_TEST_STORAGE_DIR=previousRoot;
    if(previousCI===undefined)delete process.env.CI;else process.env.CI=previousCI;
    await rm(root,{recursive:true,force:true});
  }
});
