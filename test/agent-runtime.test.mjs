import assert from "node:assert/strict";
import test from "node:test";
import { AgentRuntime } from "../src/core/intelligence/agent-runtime.mjs";

test("agent runtime requires durable registration", async () => {
  const runtime=new AgentRuntime();
  const agent=await runtime.registerSpecialist({id:"test-specialist",capabilities:["testing"]});
  assert.equal(agent.id,"test-specialist");
  assert.equal(runtime.listAgents().length,1);
});


test("agent runtime enforces per-agent concurrency capacity", async () => {
  const runtime=new AgentRuntime();
  await runtime.registerAgent({id:"capacity-agent",capabilities:["testing"],maxConcurrency:2});
  assert.equal(runtime.reserve("capacity-agent"),true);
  assert.equal(runtime.reserve("capacity-agent"),true);
  assert.equal(runtime.reserve("capacity-agent"),false);
  assert.equal(runtime.getAgent("capacity-agent").active,2);
  runtime.release("capacity-agent");
  assert.equal(runtime.reserve("capacity-agent"),true);
  assert.equal(runtime.getAgent("capacity-agent").active,2);
  runtime.release("capacity-agent");
  runtime.release("capacity-agent");
  assert.equal(runtime.getAgent("capacity-agent").active,0);
});
