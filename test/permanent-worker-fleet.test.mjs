import test from "node:test";
import assert from "node:assert/strict";
import { PERMANENT_WORKERS, createPermanentWorkerFleet, fleetStatus } from "../src/core/mesh/permanent-worker-fleet.mjs";

test("permanent fleet has 1000 assigned specialists",()=>{
  const fleet=createPermanentWorkerFleet();
  assert.equal(PERMANENT_WORKERS.length,25);
  assert.equal(fleet.workers.length,1000);
  assert.equal(new Set(fleet.workers.map(w=>w.id)).size,1000);
  assert.ok(fleet.workers.every(w=>w.permanent===true && w.job));
  assert.equal(fleet.configuredWorkers,1000);
  assert.equal(fleetStatus(fleet).total,1000);
});
