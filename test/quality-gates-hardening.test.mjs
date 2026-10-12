import test from "node:test";
import assert from "node:assert/strict";
import { productionGate, productionDoctorGate } from "../src/core/quality-gates.mjs";
import { createReleasePackage } from "../src/core/release-package.mjs";

test("release packages carry explicit version lineage",()=>{
  const pkg=createReleasePackage({title:"Test",version:"2.3.0"});
  assert.equal(pkg.version,"2.3.0");
});

test("production gate blocks incomplete packages",()=>{
  const gate=productionGate({});
  assert.equal(gate.ok,false);
  assert.ok(gate.blockers.length>0);
});

test("production doctor mirrors production readiness",()=>{
  const gate=productionDoctorGate({});
  assert.equal(gate.ok,false);
  assert.ok(gate.blockers.length>0);
});
