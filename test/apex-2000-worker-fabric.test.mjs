import test from "node:test";
import assert from "node:assert/strict";
import { APEX_WORKER_COUNT, APEX_WORKERS, assertWorkerFabric } from "../src/workers/apex-2000-worker-fabric.mjs";

test("APEX worker fabric has exactly 2,000 fixed identities",()=>{
  assert.equal(APEX_WORKER_COUNT,2000);
  assert.equal(APEX_WORKERS.length,2000);
  assert.equal(new Set(APEX_WORKERS.map(w=>w.id)).size,2000);
  assert.ok(APEX_WORKERS.every(w=>w.status==="fixed" && w.task && w.role));
  assert.equal(assertWorkerFabric(),true);
});
