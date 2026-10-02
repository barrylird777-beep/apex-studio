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


test("studio hydrates creative stores beyond projects and realism",async()=>{
  const file="./data/runtime/test-hydration-"+Date.now()+".json";
  const studio=createStudio({persistenceFile:file});
  const source=studio.sources.add({title:"Exodus Source",sourceClass:"scripture"});
  const doc=studio.knowledgeBase.addDocument({title:"Research",sourceId:source.id,text:"Moses leads Israel."});
  studio.knowledgeBase.chunk(doc.id,8);
  const scene=studio.createScene({title:"Crossing",storyId:"story_test",characters:["moses"]});
  const asset=studio.assets.create({name:"Reference Frame",kind:"image"});
  const release=studio.releases.create({name:"Test Release"});
  studio.world.set("weather","clear");
  studio.graph.addEntity({id:"moses",name:"Moses",aliases:[],attributes:{},provenance:[],tags:[]});
  await studio.save();

  const restored=createStudio({persistenceFile:file});
  await restored.load();
  assert.equal(restored.sources.get(source.id).title,"Exodus Source");
  assert.equal(restored.knowledgeBase.list()[0].title,"Research");
  assert.equal(restored.knowledgeBase.search("Moses",10).length,1);
  assert.equal(restored.getScene(scene.id).title,"Crossing");
  assert.equal(restored.assets.get(asset.id).name,"Reference Frame");
  assert.equal(restored.releases.list()[0].id,release.id);
  assert.equal(restored.world.get("weather"),"clear");
  assert.equal(restored.graph.getEntity("moses").name,"Moses");
});

test("command log preserves undo and redo semantics",()=>{
  const studio=createStudio();
  let value=0;
  studio.commands.execute({
    do(){value+=1;return value;},
    undo(){value-=1;return value;}
  });
  assert.equal(value,1);
  studio.commands.undo();
  assert.equal(value,0);
  studio.commands.redo();
  assert.equal(value,1);
});
