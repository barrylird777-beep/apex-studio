import test from "node:test";
import assert from "node:assert/strict";
import { AgentOrchestrator } from "../src/agents/orchestrator.mjs";
import { createStudio } from "../src/runtime/studio.mjs";

test("agent orchestration dispatches and records failures", async () => {
  const orchestrator = new AgentOrchestrator();
  orchestrator.register({id:"worker", async run(input){ if(input.fail) throw new Error("boom"); return {ok:true,input};}});
  const job = orchestrator.dispatch({agentId:"worker",input:{fail:false}});
  const done = await orchestrator.run(job.id);
  assert.equal(done.status,"complete");
  assert.deepEqual(done.result,{ok:true,input:{fail:false}});
  const failed = orchestrator.dispatch({agentId:"worker",input:{fail:true}});
  const result = await orchestrator.run(failed.id);
  assert.equal(result.status,"failed");
  assert.equal(result.error,"boom");
});

test("studio save/load lifecycle exists and restore is idempotent", async () => {
  const studio=createStudio();
  studio.projects.create({name:"Apex"});
  assert.equal(typeof studio.save,"function");
  assert.equal(typeof studio.load,"function");
  const snapshot=studio.snapshot();
  studio.restore(snapshot);
  studio.restore(snapshot);
  assert.equal(studio.projects.list().length,1);
});
