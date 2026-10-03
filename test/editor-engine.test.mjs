import test from "node:test";
import assert from "node:assert/strict";
import { createEditorProject, addTrack, addClip, addKeyframe, addEffect, addCaption, setTransition, createExportPlan, validateEditorProject, splitClip, trimClip, moveClip, removeClip, snapshotEditor, restoreEditor } from "../src/core/editor-engine.mjs";

test("editor supports layered media, keyframes, effects, captions and export",()=>{
  const p=createEditorProject({width:3840,height:2160,fps:60});
  const v=addTrack(p,"video","Video 1"); const a=addTrack(p,"audio","Audio 1");
  const c=addClip(p,v.id,{start:0,duration:8,mediaId:"media-1"});
  addClip(p,a.id,{start:0,duration:8,mediaId:"audio-1",volume:.8});
  addKeyframe(p,v.id,c.id,{time:0,property:"scale",value:1});
  addKeyframe(p,v.id,c.id,{time:4,property:"scale",value:1.2});
  addEffect(p,v.id,c.id,{type:"color-grade",params:{exposure:.2,contrast:.1}});
  addCaption(p,{start:1,duration:2,text:"Test caption"});
  setTransition(p,v.id,c.id,"out","crossfade",.5);
  const plan=createExportPlan(p,{codec:"h265",hardwareAcceleration:true});
  assert.equal(p.fps,60); assert.equal(p.tracks.length,2); assert.equal(c.keyframes.length,2);
  assert.equal(plan.codec,"h265"); assert.equal(validateEditorProject(p).ok,true);
});


test("editor supports split trim ripple move remove and snapshots",()=>{
 const p=createEditorProject(); const t=addTrack(p); const a=addClip(p,t.id,{start:0,duration:10}); const b=addClip(p,t.id,{start:10,duration:5});
 trimClip(p,t.id,a.id,{duration:8}); splitClip(p,t.id,a.id,4); moveClip(p,t.id,b.id,20); removeClip(p,t.id,b.id,{ripple:true});
 const snap=snapshotEditor(p); p.duration=999; restoreEditor(p,snap); assert.equal(p.duration,snap.duration); assert.equal(validateEditorProject(p).ok,true);
});
