import assert from "node:assert/strict";
import test from "node:test";
import { ApexIntelligencePlatform } from "../src/core/intelligence/platform.mjs";
import { ExecutionGraph } from "../src/core/intelligence/execution-graph.mjs";
import { EvidenceLedger } from "../src/core/intelligence/evidence-ledger.mjs";

test("capability resolution respects dependencies and quality", () => {
  const platform = new ApexIntelligencePlatform({
    capabilities: [
      { name:"base", type:"knowledge", quality:0.6, execute:async x=>x },
      { name:"expert", type:"reasoning", requires:["base"], quality:0.95, execute:async x=>x }
    ]
  });
  assert.deepEqual(platform.capabilities.dependencyOrder(["expert"]), ["base","expert"]);
  assert.equal(platform.capabilities.resolve({capabilities:["expert"]})[0].name, "expert");
});

test("execution graph runs independent work concurrently and dependencies afterward", async () => {
  const graph = new ExecutionGraph();
  const order = [];
  const a = graph.addNode({name:"a"});
  const b = graph.addNode({name:"b"});
  const c = graph.addNode({name:"c", dependsOn:[a.id,b.id]});
  const result = await graph.run(async node => {
    order.push("start:"+node.name);
    await new Promise(r=>setTimeout(r, node.name === "a" ? 10 : 1));
    order.push("end:"+node.name);
    return node.name;
  });
  assert.equal(result.passed, true);
  assert.ok(order.indexOf("start:c") > order.indexOf("end:a"));
  assert.ok(order.indexOf("start:c") > order.indexOf("end:b"));
  assert.deepEqual(result.nodes.find(n=>n.id===c.id).result, "c");
});

test("execution graph rejects dependency cycles", () => {
  const graph = new ExecutionGraph();
  const a = graph.addNode({name:"a"});
  const b = graph.addNode({name:"b", dependsOn:[a.id]});
  assert.throws(() => graph.addDependency(a.id,b.id), /cycle/i);
});

test("provider router fails over and records provider health", async () => {
  const platform = new ApexIntelligencePlatform({
    providers: [
      { name:"bad", capabilities:["reasoning"], quality:1, adapter:{generate:async()=>{throw new Error("down")}} },
      { name:"good", capabilities:["reasoning"], quality:0.9, adapter:{generate:async()=>({ok:true})} }
    ]
  });
  const result = await platform.providers.generate("task",{capabilities:["reasoning"]});
  assert.equal(result.provider,"good");
  assert.equal(platform.providers.describe("bad").health.failures,1);
  assert.equal(result.result.ok,true);
});

test("evidence ledger tracks claim lineage and confidence", () => {
  const ledger = new EvidenceLedger();
  const claim = ledger.claim({statement:"example"});
  ledger.attachEvidence(claim.id,{sourceRef:"source:1",confidence:0.9,locator:"p.4"});
  ledger.attachEvidence(claim.id,{artifactRef:"artifact:2",confidence:0.8});
  const evaluated = ledger.evaluateClaim(claim);
  assert.equal(evaluated.status,"verified");
  assert.equal(evaluated.evidenceIds.length,2);
});

test("platform planning refuses unavailable capabilities", () => {
  const platform = new ApexIntelligencePlatform();
  assert.throws(() => platform.plan({tasks:[{name:"missing",capability:"does-not-exist"}]}), /No capability/);
});
