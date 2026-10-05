import test from "node:test";
import assert from "node:assert/strict";
import { CapabilityKernel } from "../src/core/capability-kernel.mjs";

test("resolves capabilities and always adds independent verification", () => {
  const kernel = new CapabilityKernel();
  const plan = kernel.plan({goal:"build and verify a production feature", domains:["coding"]});
  assert.ok(plan.tasks.some(x => x.capability === "coding"));
  assert.ok(plan.tasks.some(x => x.capability === "verification"));
  const verifier = plan.tasks.find(x => x.capability === "verification");
  const work = plan.tasks.filter(x => x.id !== verifier.id);
  assert.deepEqual(verifier.dependsOn, work.map(x => x.id));
});

test("executes independent work in parallel and verifies the result", async () => {
  const order=[];
  const kernel = new CapabilityKernel({
    capabilities:[
      {id:"a",domains:["x"],risk:"low"},
      {id:"b",domains:["x"],risk:"low"},
      {id:"verification",domains:["qa"],risk:"high"}
    ],
    executor: async ({task}) => { order.push("start:"+task.capability); return {ok:true,capability:task.capability}; },
    verifier: async ({results}) => ({passed:results.length===3})
  });
  const result = await kernel.execute(kernel.plan({goal:"x",domains:["x"],maxParallel:8}));
  assert.equal(result.status,"completed");
  assert.equal(result.verification.passed,true);
  assert.deepEqual(order.slice(0,2).sort(),["start:a","start:b"]);
});

test("rejects dependency cycles", async () => {
  const kernel = new CapabilityKernel();
  await assert.rejects(
    kernel.execute({policy:{maxParallel:8},tasks:[
      {id:"a",capability:"coding",dependsOn:["b"]},
      {id:"b",capability:"reasoning",dependsOn:["a"]}
    ]}),
    /dependency cycle/
  );
});
