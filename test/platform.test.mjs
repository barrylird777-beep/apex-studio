import test from "node:test";
import assert from "node:assert/strict";
import { createPrivacyPolicy } from "../src/core/privacy.mjs";
import { createStudio } from "../src/runtime/studio.mjs";

test("remote providers are opt-in",()=>{
  const p=createPrivacyPolicy();
  assert.equal(p.remoteProviders,false);
  assert.equal(p.localOnly,true);
});

test("studio uses durable local persistence and restores realism",async()=>{
  const file="./data/runtime/test-state-"+Date.now()+".json";
  const studio=createStudio({persistenceFile:file});
  const project=studio.projects.create({name:"Creation"});
  studio.realism.create({id:"realism-test",label:"Cinematic"});
  await studio.save();
  const restored=createStudio({persistenceFile:file});
  await restored.load();
  assert.equal(restored.projects.get(project.id).name,"Creation");
  assert.equal(restored.realism.get("realism-test").label,"Cinematic");
});
