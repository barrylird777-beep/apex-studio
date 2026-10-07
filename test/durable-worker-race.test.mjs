import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ApexPureStore } from "../src/core/apex-pure-store.mjs";
import { ApexRingWAL } from "../src/core/apex-ring-wal.mjs";

async function storeFixture(){
  const root=await mkdtemp(path.join(tmpdir(),"apex-worker-race-"));
  const walFile=path.join(root,"wal","race.jsonl");
  const store=new ApexPureStore({root:path.join(root,"projects"),wal:new ApexRingWAL({file:walFile,ringSize:4096})});
  await store.init();
  return store;
}

test("many workers racing for jobs produce unique fenced claims",async()=>{
  const store=await storeFixture();
  const ids=await Promise.all(Array.from({length:64},(_,i)=>store.enqueue({id:"job-"+i,type:"race",payload:{i},maxAttempts:3})));
  assert.equal(ids.length,64);
  const claims=(await Promise.all(Array.from({length:16},(_,i)=>store.claim({workerId:"worker-"+i,limit:8,leaseMs:30000})))).flat();
  assert.equal(claims.length,64);
  assert.equal(new Set(claims.map(x=>x.id)).size,64);
  assert.ok(claims.every(x=>x.leaseToken&&x.leaseFence===1&&x.status==="running"));
});

test("stale fenced completion cannot finish a reclaimed job",async()=>{
  const store=await storeFixture();
  await store.enqueue({id:"fenced",type:"race",payload:{},maxAttempts:3});
  const first=(await store.claim({workerId:"a",limit:1,leaseMs:1}))[0];
  assert.ok(first);
  await new Promise(r=>setTimeout(r,5));
  assert.equal(await store.recoverExpired(10),1);
  const second=(await store.claim({workerId:"b",limit:1,leaseMs:30000}))[0];
  assert.ok(second);
  assert.notEqual(first.leaseToken,second.leaseToken);
  assert.notEqual(first.leaseFence,second.leaseFence);
  assert.equal(await store.transition("fenced","complete",{leaseToken:first.leaseToken,leaseFence:first.leaseFence,result:{stale:true}}),false);
  assert.equal(await store.transition("fenced","complete",{leaseToken:second.leaseToken,leaseFence:second.leaseFence,result:{ok:true}}),true);
});

test("concurrent completion/failure/heartbeat resolves through one mutation lane",async()=>{
  const store=await storeFixture();
  await store.enqueue({id:"serial",type:"race",payload:{},maxAttempts:3});
  const job=(await store.claim({workerId:"serial-worker",limit:1,leaseMs:30000}))[0];
  const results=await Promise.all([
    store.heartbeat(job.id,job.leaseToken,30000,job.leaseFence),
    store.transition(job.id,"complete",{leaseToken:job.leaseToken,leaseFence:job.leaseFence,result:{ok:true}}),
    store.transition(job.id,"fail",{leaseToken:job.leaseToken,leaseFence:job.leaseFence,error:"late failure"})
  ]);
  assert.equal(results.filter(Boolean).length,1);
  const final=store.jobs().find(x=>x.id==="serial");
  assert.ok(final);
  assert.equal(final.status,"completed");
});

test("dedupe is atomic under concurrent enqueue",async()=>{
  const store=await storeFixture();
  const rows=await Promise.all(Array.from({length:100},()=>store.enqueue({type:"dedupe",payload:{},dedupeKey:"same-key"})));
  assert.equal(new Set(rows.map(x=>x.id)).size,1);
  assert.equal(rows.filter(x=>x.duplicate).length,99);
});
