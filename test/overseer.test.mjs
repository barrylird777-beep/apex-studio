import test from "node:test";
import assert from "node:assert/strict";
import { createPermanentWorkerFleet } from "../src/core/mesh/permanent-worker-fleet.mjs";
import { createOverseer, overseerCycle, overseerStatus, overseerTaskFor } from "../src/core/mesh/overseer.mjs";

test("overseer manages all permanent workers",()=>{
  const fleet=createPermanentWorkerFleet();
  for(const worker of fleet.workers){worker.status="running";worker.startedAt=new Date().toISOString();worker.lastHeartbeatAt=worker.startedAt;}
  const overseer=createOverseer({intervalMs:5000});
  const next=overseerCycle(overseer,fleet);
  assert.equal(next.status,"running");
  assert.equal(fleet.workers.length,72);
  assert.equal(next.assignments,72);
  assert.equal(overseerStatus(next,fleet).activeAssignments,72);
  assert.ok(fleet.workers.every(w=>w.currentTask===overseerTaskFor(w)));
});
