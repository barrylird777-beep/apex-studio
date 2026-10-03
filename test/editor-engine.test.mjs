import test from "node:test";
import assert from "node:assert/strict";
import { createEditorProject, addTrack, addClip, addKeyframe, addEffect, addCaption, setTransition, createExportPlan, validateEditorProject } from "../src/core/editor-engine.mjs";

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
