import test from "node:test";
import assert from "node:assert/strict";
import { createPermanentWorkerFleet } from "../src/core/mesh/permanent-worker-fleet.mjs";
import { createOverseer, isWorkerStale, overseerCycle, overseerStatus, overseerTaskFor } from "../src/core/mesh/overseer.mjs";

test("overseer manages all permanent workers",()=>{
  const fleet=createPermanentWorkerFleet();
  for(const worker of fleet.workers){worker.status="running";worker.startedAt=new Date().toISOString();worker.lastHeartbeatAt=worker.startedAt;}
  const overseer=createOverseer({intervalMs:5000});
  const next=overseerCycle(overseer,fleet);
  assert.equal(next.status,"running");
  assert.equal(fleet.workers.length,144);
  assert.equal(next.assignments,144);
  assert.equal(overseerStatus(next,fleet).activeAssignments,144);
  assert.ok(fleet.workers.every(w=>w.currentTask===overseerTaskFor(w)));
});

test("overseer marks a hung task stale even when its heartbeat is fresh",()=>{
  const worker={status:"running",startedAt:new Date().toISOString(),lastHeartbeatAt:new Date().toISOString(),taskStartedAt:new Date(Date.now()-60000).toISOString(),currentTask:"long-running task"};
  assert.equal(isWorkerStale(worker,45000),true);
});
