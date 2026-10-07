import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as web from "../src/core/apex-web-search.mjs";
import { apexPureStore } from "../src/core/apex-pure-store.mjs";

test("Pure-WAL exports the universal durable execution primitives",async()=>{
  for(const name of ["enqueue","claim","heartbeat","transition","recoverExpired","snapshot"])
    assert.equal(typeof apexPureStore[name],"function",name);
});

test("search surface exposes multi-engine public-web research",async()=>{
  assert.equal(typeof web.searchAnything,"function");
  assert.equal(typeof web.fetchAnything,"function");
  const result=await web.searchAnything("Apex Studio",{limit:3,engines:"DuckDuckGo"});
  assert.equal(result.query,"Apex Studio");
  assert.ok(Array.isArray(result.results));
  assert.ok(Array.isArray(result.errors));
});

test("retired relational adapter is inert",async()=>{
  const source=await readFile("src/db/index.ts","utf8");
  assert.match(source,/pool=null/);
  assert.match(source,/db=null/);
  assert.doesNotMatch(source,/from ["']pg/);
});
