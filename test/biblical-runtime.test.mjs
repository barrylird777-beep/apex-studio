import test from "node:test";
import assert from "node:assert/strict";
import { createStudio } from "../src/runtime/studio.mjs";

test("studio exposes Biblical Story Engine and Torah",()=>{
  const studio=createStudio();
  assert.equal(studio.torah.books.length,5);
  assert.equal(studio.torah.books[0].hebrew,"Bereshit");
  const story=studio.biblical.createStory({title:"Creation Story"});
  const event=studio.biblical.addEvent(story.id,{title:"Beginning",sourceRefs:[]});
  assert.equal(studio.biblical.toScene(event.id).provenance.eventId,event.id);
  const snap=studio.snapshot();
  const restored=createStudio();
  restored.restore(snap);
  assert.equal(restored.biblical.getEvent(event.id).title,"Beginning");
});

test("studio command router exposes biblical operations",async()=>{
  const studio=createStudio();
  const story=await studio.command("create.biblical.story",{title:"Exodus"});
  const event=await studio.command("add.biblical.event",{storyId:story.id,title:"Departure"});
  const provenance=await studio.command("biblical.provenance",{eventId:event.id});
  assert.deepEqual(provenance,[]);
});

test("Biblical production plan validates source-backed events",()=>{
  const studio=createStudio();
  const source=studio.sources.add({id:"genesis",title:"Genesis",sourceClass:"scripture",canonicalStatus:"Jewish/Christian"});
  const story=studio.biblical.createStory({title:"Genesis Film",sourceIds:[source.id]});
  const event=studio.biblical.addEvent(story.id,{title:"Creation",sourceRefs:[{sourceId:source.id,locator:"Genesis 1"}]});
  const plan=studio.biblical.buildProductionPlan(story.id);
  assert.equal(plan.length,1);
  assert.equal(plan[0].scene.provenance.sourceRefs[0].locator,"Genesis 1");
  assert.equal(studio.biblical.validateStory(story.id).valid,true);
  assert.equal(event.dramatization,"direct");
});