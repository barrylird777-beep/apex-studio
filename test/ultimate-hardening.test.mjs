import test from "node:test";
import assert from "node:assert/strict";
import { requiredString, positiveInt } from "../src/core/validation.mjs";
import { createStudio } from "../src/runtime/studio.mjs";

test("validation rejects malformed input",()=>{
  assert.throws(()=>requiredString("", "name"), /name must be a string/);
  assert.throws(()=>positiveInt(0, "limit"), /positive integer/);
  assert.equal(requiredString("  Apex  ","name"),"Apex");
});

test("studio snapshot is safe to expose",()=>{
  const studio=createStudio();
  studio.secrets.set("API_KEY","super-secret");
  const snapshot=studio.snapshot();
  assert.deepEqual(snapshot.secrets,{API_KEY:"[REDACTED]"});
});

test("job queue records failures instead of losing them",async()=>{
  const studio=createStudio();
  studio.jobs.register("explode",()=>{throw new Error("boom")});
  const job=studio.jobs.enqueue("explode");
  const result=await studio.jobs.run(job.id);
  assert.equal(result.status,"failed");
  assert.equal(result.error,"boom");
});
