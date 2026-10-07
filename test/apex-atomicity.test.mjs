import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ApexPureStore } from "../src/core/apex-pure-store.mjs";
import { ApexRingWAL } from "../src/core/apex-ring-wal.mjs";

test("concurrent claims are serialized and each queued job is claimed once",async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),"apex-atomic-"));
 const store=new ApexPureStore({root:path.join(dir,"projects"),wal:new ApexRingWAL({file:path.join(dir,"wal.jsonl")})});
 await store.init();
 for(let i=0;i<40;i++)await store.enqueue({id:"job-"+i,type:"atomic",payload:{i}});
 const claims=await Promise.all(Array.from({length:8},(_,i)=>store.claim({workerId:"w"+i,limit:10})));
 const ids=claims.flat().map(x=>x.id);
 assert.equal(ids.length,40);
 assert.equal(new Set(ids).size,40);
 assert.equal(store.jobs().filter(x=>x.status==="running").length,40);
});
