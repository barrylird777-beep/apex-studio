import assert from "node:assert/strict";
import test from "node:test";
import { createApexIntelligenceSystem } from "../src/core/intelligence/system.mjs";

test("Apex intelligence system composes durable execution components", async () => {
  const system=createApexIntelligenceSystem({
    capabilities:[{name:"echo",type:"utility",execute:async input=>({echo:input})}],
    agents:[{id:"echo-agent",role:"utility",capabilities:["echo"]}],
    verifierChecks:[{id:"output-shape",run:async target=>({passed:target.output?.echo!==undefined})}]
  });
  const inspected=await system.bootstrap();
  assert.equal(inspected.agents.length,1);
  assert.equal(inspected.verifierChecks,1);
  assert.ok(system.controlPlane);
  assert.ok(system.worker);
});
