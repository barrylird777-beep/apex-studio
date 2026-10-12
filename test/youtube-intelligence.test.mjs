import test from "node:test";
import assert from "node:assert/strict";
import { ChannelIntelligence, buildScriptBrief } from "../src/core/youtube-intelligence.mjs";

test("lifetime intelligence aggregates channel history",async()=>{
 const x=new ChannelIntelligence();
 await x.ingest({channel:{title:"Test"},videos:[
  {id:"1",title:"Alpha",publishedAt:"2025-01-01",views:1000,impressionsCtr:5,averagePercentageViewed:40,likes:50,comments:10,subscribersGained:20,topic:"Exodus"},
  {id:"2",title:"Beta",publishedAt:"2025-02-01",views:5000,impressionsCtr:9,averagePercentageViewed:55,likes:300,comments:40,subscribersGained:120,topic:"Exodus"}
 ]});
 assert.equal(x.state.lifetime.videos,2);
 assert.equal(x.state.lifetime.totalViews,6000);
 assert.equal(x.state.patterns.topic[0].key,"Exodus");
 assert.ok(x.state.videoAnalysis[1].derived.opportunityIndex>x.state.videoAnalysis[0].derived.opportunityIndex);
});
test("script factory produces production brief",()=>{
 const b=buildScriptBrief({topic:"The Exodus",durationMinutes:10});
 assert.equal(b.topic,"The Exodus");assert.ok(b.researchQuestions.length>=4);assert.ok(b.deliverables.includes("full narration"));
});
