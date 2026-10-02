import test from "node:test";
import assert from "node:assert/strict";
import { createEpisodeGenome } from "../src/core/episode-genome.mjs";
test("episode genome carries observed growth data",()=>{
 const g=createEpisodeGenome({episodeId:"ep",sourceRefs:["Gen 1:1"],hook:"Hook",growth:{experimentId:"x",metrics:{views:100}}});
 assert.equal(g.version,"1.1.0");
 assert.equal(g.outcomes.growth.metrics.views,100);
});
