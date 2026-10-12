import test from "node:test";
import assert from "node:assert/strict";
import { createOvernightKnowledgePlan, auditOvernightPlan, nextKnowledgeTasks } from "../src/core/knowledge/overnight-knowledge.mjs";

test("overnight plan contains only knowledge and production-reference work",()=>{
  const plan=createOvernightKnowledgePlan({hours:10});
  const audit=auditOvernightPlan(plan);
  assert.equal(audit.total,27);
  assert.equal(audit.storyWork,0);
  assert.equal(plan.rules.noStoryCreation,true);
  assert.equal(plan.rules.requireProvenance,true);
  assert.equal(nextKnowledgeTasks(plan,4).length,4);
});
