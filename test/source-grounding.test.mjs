import test from "node:test";
import assert from "node:assert/strict";
import { auditSourceRefs, seedStoryIntelligenceFromHits } from "../src/core/source-grounding.mjs";

test("source grounding propagates exact refs into story intelligence",()=>{
 const refs=[{type:"bible",version:"x",book:"Genesis",chapter:1,verse:1}];
 const out=seedStoryIntelligenceFromHits({sourceRefs:refs,entities:[{id:"e1",name:"Creator"}],events:[{id:"ev1",type:"action",entityIds:["e1"]}],claims:[{id:"c1",text:"A claim",class:"scripture"}],chronology:[{eventId:"ev1",order:1}]});
 assert.deepEqual(out.entities[0].sourceRefs,refs);
 assert.deepEqual(out.events[0].sourceRefs,refs);
 assert.deepEqual(out.claims[0].sourceRefs,refs);
 assert.deepEqual(out.chronology[0].sourceRefs,refs);
});

test("source reference audit rejects incomplete references",()=>{
 const audit=auditSourceRefs([{type:"bible",version:"kjv",book:"Genesis",chapter:1}]);
 assert.equal(audit.ready,false);
 assert.equal(audit.blockers[0].code,"invalid-source-ref");
});
