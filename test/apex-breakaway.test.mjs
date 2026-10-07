import test from "node:test";
import assert from "node:assert/strict";
import { searchAnything } from "../src/core/apex-web-search.mjs";
import { apexPureStore } from "../src/core/apex-pure-store.mjs";

test("Pure-WAL exports the universal durable execution primitives",async()=>{
  for(const name of ["enqueue","claim","heartbeat","transition","recoverExpired","snapshot"])
    assert.equal(typeof apexPureStore[name],"function",name);
});

test("search surface exposes multi-engine public-web research",async()=>{
  const source=await import("../src/core/apex-web-search.mjs");
  assert.equal(typeof source.searchAnything,"function");
  assert.equal(typeof source.fetchAnything,"function");
  const result=await source.searchAnything("Apex Studio",{limit:3,engines:"DuckDuckGo"});
  assert.equal(result.query,"Apex Studio");
  assert.ok(Array.isArray(result.results));
  assert.ok(Array.isArray(result.errors));
});

test("retired relational runtime has no live database dependency",async()=>{
  const db=await import("../src/db/index.ts");
  assert.equal(db.pool,null);
  assert.equal(db.db,null);
});
