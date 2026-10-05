import assert from "node:assert/strict";
import test from "node:test";
import { TITAN_PROFILE, createTitanCrew } from "../src/core/intelligence/titan-profile.mjs";
import { TitanOrchestrator } from "../src/core/intelligence/titan-orchestrator.mjs";

test("TITAN has bounded engineering authority",()=>{
  assert.equal(TITAN_PROFILE.authority,"recommend-only");
  assert.equal(createTitanCrew().length,7);
  const titan=new TitanOrchestrator({runtime:{},controlPlane:{}});
  assert.equal(titan.authority().canImplement,true);
  assert.equal(titan.authority().canMerge,false);
  assert.equal(titan.authority().canRelease,false);
});

test("TITAN refuses self-certification",async()=>{
  const titan=new TitanOrchestrator({runtime:{},controlPlane:{}});
  await assert.rejects(()=>titan.verify({ok:true}),/independent verifier/);
});
