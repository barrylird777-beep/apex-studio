import test from "node:test";
import assert from "node:assert/strict";
import { createPackagingVariant, createGrowthExperiment, recordGrowthMetrics, growthLearningReport } from "../src/core/growth-engine.mjs";

test("growth engine records observed analytics without inventing performance",()=>{
  const v=createPackagingVariant({title:"Test"});
  const e=createGrowthExperiment({variants:[v]});
  const x=recordGrowthMetrics(e,{impressions:1000,clicks:80,views:70,unknown:999});
  assert.equal(x.metrics.impressions,1000);
  assert.equal(x.metrics.clicks,80);
  assert.equal(x.metrics.unknown,undefined);
  assert.deepEqual(growthLearningReport(x).metrics,{impressions:1000,clicks:80,views:70});
});
