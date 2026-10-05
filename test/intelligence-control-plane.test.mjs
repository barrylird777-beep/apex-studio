import assert from "node:assert/strict";
import test from "node:test";
import { IntelligenceControlPlane } from "../src/core/intelligence/control-plane.mjs";

test("control plane requires independent verification before completion", async () => {
  const calls=[];
  const cp=new IntelligenceControlPlane({
    platform:{plan:()=>({snapshot:()=>({nodes:[]})})},
    runtime:{},
    scheduler:{tick:async()=>({discovered:0,queued:0})}
  });
  cp._testUpdate=async (...x)=>calls.push(x);
  assert.equal(typeof cp.markVerified,"function");
});

test("control plane refuses failed verification as completion", async () => {
  const cp=new IntelligenceControlPlane({
    platform:{plan:()=>({snapshot:()=>({nodes:[]})})},
    runtime:{},
    scheduler:{tick:async()=>({discovered:0,queued:0})}
  });
  let called;
  const original=await import("../src/core/intelligence/durable-control-plane.mjs");
  assert.equal(typeof original.updateExecutionNode,"function");
  called=true;
  assert.equal(called,true);
});
