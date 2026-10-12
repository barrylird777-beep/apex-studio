import test from "node:test";
import assert from "node:assert/strict";
import { retryWalStartup } from "../src/core/wal-startup-retry.mjs";

test("Pure-WAL startup retries transient cross-process lock contention", async () => {
  let attempts=0;
  const delays=[];
  const result=await retryWalStartup(async()=>{
    attempts++;
    if(attempts<3)throw new Error("[WAL_LOCK] Timed out waiting for the cross-process WAL lock.");
    return "ready";
  },{
    wait:async ms=>delays.push(ms),
    onRetry:()=>{},
    baseDelayMs:10,
    maxDelayMs:100,
    random:()=>0
  });
  assert.equal(result,"ready");
  assert.equal(attempts,3);
  assert.deepEqual(delays,[10,20]);
});

test("Pure-WAL startup does not retry integrity or unrelated failures", async () => {
  let attempts=0;
  await assert.rejects(retryWalStartup(async()=>{
    attempts++;
    throw new Error("[WAL_INTEGRITY] hash chain failure");
  },{wait:async()=>{},onRetry:()=>{}}),/WAL_INTEGRITY/);
  assert.equal(attempts,1);
});

test("Pure-WAL startup exits its retry loop cleanly during shutdown", async () => {
  let stopping=false;
  let attempts=0;
  const result=await retryWalStartup(async()=>{
    attempts++;
    throw new Error("[WAL_LOCK] lock busy");
  },{
    isStopping:()=>stopping,
    wait:async()=>{stopping=true;},
    onRetry:()=>{},
    baseDelayMs:1,
    random:()=>0
  });
  assert.equal(result,false);
  assert.equal(attempts,1);
});
