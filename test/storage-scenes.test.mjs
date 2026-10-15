import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { startTestPeerBridge } from "./helpers/test-peer-storage-bridge.mjs";

test("scene assets persist with media URLs and a hydrated project manifest",async()=>{
  const root=await mkdtemp(path.join(tmpdir(),"apex-scene-store-"));
  const previousRoot=process.env.APEX_TEST_STORAGE_DIR;
  const previousCI=process.env.CI;
  const previousApp=process.env.APEX_APP_NAMESPACE;
  const previousToken=process.env.APEX_PEER_STORAGE_API_TOKEN_KERNELVISION;
  const previousSocket=process.env.APEX_PEER_STORAGE_API_SOCKET;
  const socketPath=path.join(tmpdir(),"apex-scene-peer-"+crypto.randomUUID()+".sock");
  const peer=await startTestPeerBridge(socketPath);
  process.env.CI="true";
  process.env.APEX_TEST_STORAGE_DIR=root;
  process.env.APEX_APP_NAMESPACE="KernelVision";
  process.env.APEX_PEER_STORAGE_API_TOKEN_KERNELVISION=peer.tokens.KernelVision;
  process.env.APEX_PEER_STORAGE_API_SOCKET=socketPath;
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
    for(const asset of [video,audio]){
      assert.match(asset.url,/^\/api\/peer-assets\/[a-f0-9]{64}$/);
      const recovered=await storage.getPeerAsset(asset.hash);
      assert.ok(recovered.length>0);
      assert.equal(crypto.createHash("sha256").update(recovered).digest("hex"),asset.sha256);
    }
  }finally{
    if(previousRoot===undefined)delete process.env.APEX_TEST_STORAGE_DIR;else process.env.APEX_TEST_STORAGE_DIR=previousRoot;
    if(previousCI===undefined)delete process.env.CI;else process.env.CI=previousCI;
    if(previousApp===undefined)delete process.env.APEX_APP_NAMESPACE;else process.env.APEX_APP_NAMESPACE=previousApp;
    if(previousToken===undefined)delete process.env.APEX_PEER_STORAGE_API_TOKEN_KERNELVISION;else process.env.APEX_PEER_STORAGE_API_TOKEN_KERNELVISION=previousToken;
    if(previousSocket===undefined)delete process.env.APEX_PEER_STORAGE_API_SOCKET;else process.env.APEX_PEER_STORAGE_API_SOCKET=previousSocket;
    await peer.close();
    await rm(root,{recursive:true,force:true});
  }
});
