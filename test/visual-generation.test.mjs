import test from "node:test";
import assert from "node:assert/strict";
import { VisualBible } from "../src/core/visual-bible.mjs";
import { buildVisualPrompt, GenerationQueue } from "../src/core/visual-generation.mjs";

test("visual bible preserves character and location continuity data",()=>{
 const v=new VisualBible();
 const c=v.createCharacter({name:"Moses",description:"Leader",appearance:{hair:"dark"},doNotChange:["robe"]});
 const l=v.createLocation({name:"Sinai",description:"Rocky mountain"});
 assert.equal(v.getCharacter(c.id).doNotChange[0],"robe");
 assert.equal(v.getLocation(l.id).name,"Sinai");
});

test("visual prompt carries source context and continuity",()=>{
 const prompt=buildVisualPrompt({shot:{visualPrompt:"Moses raises his staff",sourceRefs:[{locator:"Exodus 14:16"}]},characters:[{name:"Moses",description:"Leader",appearance:{hair:"dark"}}],location:{name:"Red Sea",description:"shore"}});
 assert.match(prompt.positive,/Exodus 14:16/);
 assert.match(prompt.positive,/Moses/);
});

test("generation queue is provider-neutral",()=>{
 const q=new GenerationQueue();const j=q.enqueue({mode:"manual",shotId:"s1"});
 assert.equal(j.status,"queued");assert.equal(j.mode,"manual");
});
