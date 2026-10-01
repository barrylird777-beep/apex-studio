import test from "node:test";
import assert from "node:assert/strict";
import { SourceRegistry } from "../src/core/sources.mjs";
import { BiblicalStoryEngine } from "../src/biblical/story-engine.mjs";

test("source-backed stories preserve Torah and Enoch provenance",()=>{
  const sources=new SourceRegistry();
  sources.add({id:"torah",title:"Torah",sourceClass:"scripture",canonicalStatus:"Jewish"});
  sources.add({id:"enoch",title:"1 Enoch",sourceClass:"enochic",canonicalStatus:"tradition-dependent"});
  const engine=new BiblicalStoryEngine({sourceRegistry:sources});
  const story=engine.createStory({title:"Ancient Story",sourceIds:["torah","enoch"]});
  const event=engine.addEvent(story.id,{title:"Vision",dramatization:"dramatization",
    sourceRefs:[{sourceId:"torah",locator:"Genesis 6:1-4"},{sourceId:"enoch",locator:"1 Enoch 6"}]});
  assert.equal(engine.provenance(event.id)[0].source.sourceClass,"scripture");
  assert.equal(engine.provenance(event.id)[1].source.sourceClass,"enochic");
  assert.equal(engine.toScene(event.id).provenance.sourceRefs.length,2);
});