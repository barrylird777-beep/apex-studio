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
  assert.equal(web.searchAnything.length,2);
  assert.equal(web.fetchAnything.length,1);
});

test("retired relational adapter is inert",async()=>{
  const source=await readFile("src/db/index.ts","utf8");
  assert.match(source,/pool=null/);
  assert.match(source,/db=null/);
  assert.doesNotMatch(source,/from ["']pg/);
});
