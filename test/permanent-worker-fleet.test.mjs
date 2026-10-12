import test from "node:test";
import assert from "node:assert/strict";
import { PERMANENT_WORKERS, WORKER_SKILLSETS, createPermanentWorkerFleet, fleetStatus } from "../src/core/mesh/permanent-worker-fleet.mjs";

test("permanent fleet has 1000 assigned specialists",()=>{
  const fleet=createPermanentWorkerFleet();
  assert.equal(PERMANENT_WORKERS.length,25);
  assert.equal(fleet.workers.length,1000);
  assert.equal(new Set(fleet.workers.map(w=>w.id)).size,1000);
  assert.ok(fleet.workers.every(w=>w.permanent===true && w.job && Array.isArray(w.skills) && w.skills.length>0));
  assert.equal(Object.keys(WORKER_SKILLSETS).length,25);
  assert.ok(fleet.workers.every(w=>w.skillset?.permanent===true && w.skillset?.recovery===true && w.skillset?.validation===true));
  assert.equal(fleet.configuredWorkers,1000);
  assert.equal(fleetStatus(fleet).total,1000);
});
