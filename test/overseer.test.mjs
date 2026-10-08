import test from "node:test";
import assert from "node:assert/strict";
import { createPermanentWorkerFleet } from "../src/core/mesh/permanent-worker-fleet.mjs";
import { createOverseer, isWorkerStale, overseerCycle, overseerStatus } from "../src/core/mesh/overseer.mjs";

test("overseer monitors permanent workers without inventing assignments or heartbeats",()=>{
  const fleet=createPermanentWorkerFleet();
  const heartbeat=new Date().toISOString();
  for(const worker of fleet.workers){worker.status="running";worker.startedAt=heartbeat;worker.lastHeartbeatAt=heartbeat;}
  const overseer=createOverseer({intervalMs:5000});
  const next=overseerCycle(overseer,fleet);
  assert.equal(next.status,"running");
  assert.equal(fleet.workers.length,1000);
  assert.equal(next.assignments,0);
  assert.equal(overseerStatus(next,fleet).activeAssignments,0);
  assert.ok(fleet.workers.every(w=>w.currentTask===null));
  assert.ok(fleet.workers.every(w=>w.lastHeartbeatAt===heartbeat));
});

test("overseer requests recovery for a stalled task without refreshing its heartbeat",()=>{
  const heartbeat=new Date().toISOString();
  const worker={status:"running",startedAt:heartbeat,lastHeartbeatAt:heartbeat,taskStartedAt:new Date(Date.now()-60000).toISOString(),taskProgressAt:new Date(Date.now()-60000).toISOString(),currentTask:"long-running task"};
  const fleet={workers:[worker]};
  const overseer=createOverseer({staleAfterMs:45000});
  const next=overseerCycle(overseer,fleet);
  assert.equal(isWorkerStale(worker,45000),true);
  assert.equal(next.staleWorkers,1);
  assert.equal(next.recoveryRequests,1);
  assert.equal(worker.recoveryState,"restart_requested");
  assert.equal(worker.lastHeartbeatAt,heartbeat);
  assert.equal(overseerStatus(next,fleet).restartRequestedWorkers,1);
  const repeated=overseerCycle(next,fleet);
  assert.equal(repeated.recoveryRequests,1,"the same stale worker must not emit duplicate recovery requests every cycle");
});

test("fresh task progress prevents a false stale signal for long-running work",()=>{
  const worker={status:"running",startedAt:new Date(Date.now()-120000).toISOString(),lastHeartbeatAt:new Date(Date.now()-120000).toISOString(),taskStartedAt:new Date(Date.now()-120000).toISOString(),taskProgressAt:new Date().toISOString(),currentTask:"long-running task"};
  assert.equal(isWorkerStale(worker,45000),false);
});

test("idle logical workers are not treated as crashed workers",()=>{
  const worker={status:"idle",startedAt:new Date(Date.now()-120000).toISOString(),lastHeartbeatAt:new Date(Date.now()-120000).toISOString(),currentTask:null};
  assert.equal(isWorkerStale(worker,45000),false);
});
