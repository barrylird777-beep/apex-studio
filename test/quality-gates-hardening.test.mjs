import test from "node:test";
import assert from "node:assert/strict";
import { scriptureGate, productionDoctorGate } from "../src/core/quality-gates.mjs";
import { createReleasePackage } from "../src/core/release-package.mjs";

test("release packages carry explicit version lineage",()=>{
  const pkg=createReleasePackage({title:"Test",version:"2.3.0"});
  assert.equal(pkg.version,"2.3.0");
});

test("scripture gate blocks episodes without source grounding",()=>{
  const gate=scriptureGate({truthGraph:{entities:[],claims:[],evidence:[],relationships:[],sourceRefs:[]}});
  assert.equal(gate.ok,false);
  assert.ok(gate.blockers.some(x=>x.name==="source-attached"));
});

test("production doctor is not a placeholder",()=>{
  const gate=productionDoctorGate({});
  assert.equal(gate.ok,false);
  assert.ok(gate.blockers.length>0);
});
