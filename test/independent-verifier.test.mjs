import assert from "node:assert/strict";
import test from "node:test";
import { IndependentVerifier } from "../src/core/intelligence/independent-verifier.mjs";

test("independent verifier requires every registered check to pass", async () => {
  const verifier=new IndependentVerifier({
    checks:[
      {id:"schema",run:async()=>({passed:true})},
      {id:"security",run:async()=>({passed:false,reason:"bad"})}
    ]
  });
  const result=await verifier.verify({id:"x"});
  assert.equal(result.passed,false);
  assert.equal(result.checks.length,2);
});

test("independent verifier fails closed when a check throws", async () => {
  const verifier=new IndependentVerifier({checks:[{id:"test",run:async()=>{throw new Error("boom")}}]});
  const result=await verifier.verify({});
  assert.equal(result.passed,false);
  assert.match(result.checks[0].detail.error,/boom/);
});
