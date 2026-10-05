import assert from "node:assert/strict";
import test from "node:test";
import { AgentRuntime } from "../src/core/intelligence/agent-runtime.mjs";

test("agent runtime requires durable registration", async () => {
  const runtime=new AgentRuntime();
  const agent=await runtime.registerSpecialist({id:"test-specialist",capabilities:["testing"]});
  assert.equal(agent.id,"test-specialist");
  assert.equal(runtime.listAgents().length,1);
});
