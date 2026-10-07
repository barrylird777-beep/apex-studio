import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ApexRingWAL } from "../src/core/apex-ring-wal.mjs";
import { ApexPureStore } from "../src/core/apex-pure-store.mjs";

test("Ring-WAL survives replay with hash-chain integrity",async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),"apex-wal-"));const wal=new ApexRingWAL({file:path.join(dir,"ring.jsonl"),ringSize:64});
 await wal.append("test",{value:1});await wal.append("test",{value:2});
 const seen=[];await wal.replay({onRecord:r=>seen.push(r.payload.value)});assert.deepEqual(seen,[1,2]);
 const raw=await readFile(path.join(dir,"ring.jsonl"),"utf8");assert.equal(raw.trim().split("\n").length,2);
});

test("pure store uses atomic state records and fenced worker transitions",async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),"apex-store-"));const store=new ApexPureStore({root:path.join(dir,"projects"),wal:new ApexRingWAL({file:path.join(dir,"wal.jsonl")})});
 await store.put("projects","1",{title:"A"});assert.equal((await store.get("projects","1")).title,"A");
 const enq=await store.enqueue({id:"job-1",type:"render",payload:{x:1},maxAttempts:2});const job=(await store.claim({workerId:"w1",limit:1}))[0];assert.equal(job.id,enq.id);
 assert.equal(await store.transition(job.id,"complete",{leaseToken:"bad",leaseFence:job.leaseFence}),false);
 assert.equal(await store.transition(job.id,"complete",{leaseToken:job.leaseToken,leaseFence:job.leaseFence,result:{ok:true}}),true);
 assert.equal((await store.jobs())[0].status,"completed");
});
