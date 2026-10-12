import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  ensureWorkerTaskSchema,
  enqueueWorkerTask,
  claimNextWorkerTasks,
  claimWorkerTask,
  heartbeatWorkerTask,
  completeWorkerTask,
  closeWorkerStore,
  claimExternalEffect,
  completeExternalEffect,
  releaseWorkerTasks,
  acquireAiRateLimit,
  durableWorkerHealth
} from "../src/core/mesh/durable-worker-store.mjs";

test("Pure-WAL worker store initializes without a database", async () => {
  assert.equal(await ensureWorkerTaskSchema(), true);
  const health=await durableWorkerHealth();
  assert.equal(health.available,true);
  assert.equal(health.storage,"local-pure-wal");
});

test("concurrent workers race for one task and only one claim wins", async () => {
  const id=crypto.randomUUID();
  await enqueueWorkerTask({id,workerId:"race-test",role:"race-test",task:"race-test"});
  const [a,b]=await Promise.all([claimWorkerTask(id,15000),claimWorkerTask(id,15000)]);
  const claimed=[a,b].filter(Boolean);
  assert.equal(claimed.length,1);
  assert.equal(claimed[0].id,id);
  assert.equal(await completeWorkerTask(id,{ok:true},claimed[0].lease_token),true);
  assert.equal(await completeWorkerTask(id,{stale:true},claimed[0].lease_token),false);
});

test("lease heartbeat extends the active fence and token checks reject stale work", async () => {
  const id=crypto.randomUUID();
  await enqueueWorkerTask({id,workerId:"heartbeat-test",role:"heartbeat-test",task:"heartbeat-test"});
  const task=await claimWorkerTask(id,15000);
  assert.ok(task?.lease_token);
  const before=await (await import("../src/core/mesh/durable-worker-store.mjs")).getWorkerTask(id);
  assert.equal(await heartbeatWorkerTask(id,30000,task.lease_token,task.lease_fence),true);
  const after=await (await import("../src/core/mesh/durable-worker-store.mjs")).getWorkerTask(id);
  assert.ok(after.leaseExpiresAt>before.leaseExpiresAt);
  assert.equal(await completeWorkerTask(id,{ok:true},task.lease_token,task.lease_fence),true);
});


test("expired worker leases cannot complete and are safely reclaimed with a higher fence", async () => {
  const id=crypto.randomUUID();
  await enqueueWorkerTask({id,workerId:"expiry-test",role:"expiry-test",task:"expiry-test",maxAttempts:3});
  const first=await claimWorkerTask(id,1000);
  assert.ok(first?.lease_token);
  await new Promise(resolve=>setTimeout(resolve,1100));
  assert.equal(await completeWorkerTask(id,{stale:true},first.lease_token,first.lease_fence),false);
  assert.equal(await (await import("../src/core/mesh/durable-worker-store.mjs")).requeueExpiredWorkerTasks(),1);
  await new Promise(resolve=>setTimeout(resolve,1100));
  const second=await claimWorkerTask(id,15000);
  assert.ok(second?.lease_token);
  assert.ok(second.lease_fence>first.lease_fence);
  assert.equal(await completeWorkerTask(id,{recovered:true},second.lease_token,second.lease_fence),true);
});

test("external effect idempotency admits exactly one concurrent caller", async () => {
  const key="pure-wal-effect-"+crypto.randomUUID();
  const [a,b]=await Promise.all([claimExternalEffect(key),claimExternalEffect(key)]);
  assert.equal([a,b].filter(Boolean).length,1);
  assert.equal(await completeExternalEffect(key,{ok:true}),true);
  assert.equal(await completeExternalEffect(key,{ok:true}),false);
});

test("shutdown release requires exact task-to-token pairing", async () => {
  const ids=[crypto.randomUUID(),crypto.randomUUID()];
  for(const id of ids) await enqueueWorkerTask({id,workerId:"release-test",role:"release-test",task:"release-test"});
  const tasks=await claimNextWorkerTasks(2,15000,"release-test");
  assert.equal(tasks.length,2);
  const tokens=tasks.map(task=>task.lease_token);
  const taskIds=tasks.map(task=>task.id);
  assert.equal(await releaseWorkerTasks(taskIds,[tokens[1],tokens[0]]),0);
  assert.equal(await releaseWorkerTasks(taskIds,tokens),2);
  await new Promise(resolve=>setTimeout(resolve,125));
  for(const task of tasks) {
    const reclaimed=await claimWorkerTask(task.id,15000);
    assert.ok(reclaimed);
    assert.equal(await completeWorkerTask(task.id,{ok:true},reclaimed.lease_token,reclaimed.lease_fence),true);
  }
});

test("rate limiter uses durable state and has a bounded wait", async () => {
  const key="pure-wal-rate-"+crypto.randomUUID();
  assert.equal(await acquireAiRateLimit({key,capacity:1,refillPerSecond:0.0001,maxWaitMs:100}),true);
  assert.equal(await acquireAiRateLimit({key,capacity:1,refillPerSecond:0.0001,retryMs:50,maxWaitMs:100}),false);
  await closeWorkerStore();
});
