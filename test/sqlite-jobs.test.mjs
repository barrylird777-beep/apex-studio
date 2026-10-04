import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import TestDb from 'better-sqlite3';
import { createQueue } from '../src/jobs/queue.mjs';
import { createOverseer, nonRetryable } from '../src/jobs/overseer.mjs';
import { createSqliteStore, createSqliteLedger } from '../src/jobs/sqlite-store.mjs';

function mk(db=new TestDb(':memory:'),clock={t:1_000_000}){
  let n=0;
  const queue=createQueue({store:createSqliteStore(db),now:()=>clock.t,token:()=>`tok-${++n}`,leaseMs:1000,baseBackoffMs:100,maxBackoffMs:10000});
  return {db,clock,queue};
}

test('sqlite: claim order, dedupe, retry backoff, dead at maxAttempts',async()=>{
  const {clock,queue}=mk();
  const a=await queue.enqueue({type:'t',payload:{n:1},dedupeKey:'k'});
  assert.equal((await queue.enqueue({type:'t',dedupeKey:'k'})).id,a.id);
  await queue.enqueue({type:'t',payload:{n:2}});
  await queue.enqueue({type:'t',payload:{n:3},runAt:clock.t+5000});
  let j=await queue.claim('w1'); assert.equal(j.id,a.id);
  assert.equal((await queue.claim('w2')).payload.n,2);
  assert.equal(await queue.claim('w3'),null);
  assert.equal(await queue.fail(j,new Error('boom')),true);
  assert.equal(await queue.claim('w1'),null);
  clock.t+=100;j=await queue.claim('w1');assert.equal(j.attempts,2);
  await queue.fail(j,nonRetryable('stop'));assert.equal((await queue.store.counts()).dead,1);
});

test('sqlite: expired lease is recovered and old worker is fenced out',async()=>{
  const {clock,queue}=mk(); await queue.enqueue({type:'t'});
  const j1=await queue.claim('w1');clock.t+=1500;assert.equal((await queue.recoverStale()).length,1);
  clock.t+=100;const j2=await queue.claim('w2');
  assert.notEqual(j2.leaseToken,j1.leaseToken);
  assert.equal(await queue.complete(j1),false);assert.equal(await queue.heartbeat(j1),false);
  assert.equal(await queue.complete(j2,{ok:1}),true);
  assert.deepEqual((await queue.store.listByStatus('done'))[0].result,{ok:1});
  assert.equal((await queue.store.listRecovered()).length,1);
});

test('sqlite: jobs survive restart and two connections never lease same job',async()=>{
  const file=`${mkdtempSync(`${tmpdir()}/apex-jobs-`)}/jobs.db`,clock={t:1_000_000};
  const first=mk(new TestDb(file),clock);
  for(let i=0;i<4;i++)await first.queue.enqueue({type:'t',payload:{i}});
  first.db.close();
  const a=mk(new TestDb(file),clock),b=mk(new TestDb(file),clock);
  for(const x of [a,b]){x.db.pragma('journal_mode=WAL');x.db.pragma('busy_timeout=5000');}
  const got=[];
  for(let i=0;i<2;i++)got.push(await a.queue.claim('wa'),await b.queue.claim('wb'));
  assert.equal(got.filter(Boolean).length,4);
  assert.equal(new Set(got.map(j=>j.id)).size,4);
  assert.equal(await a.queue.claim('wa'),null);
  a.db.close();b.db.close();
});

test('sqlite: overseer runs job end to end',async()=>{
  const {queue}=mk();
  const ov=createOverseer({queue,workerId:'w',heartbeatMs:1e9,handlers:{double:async(p)=>({v:p.n*2})}});
  await queue.enqueue({type:'double',payload:{n:21}});
  assert.equal((await ov.runOnce()).status,'done');
  assert.equal((await queue.store.listByStatus('done'))[0].result.v,42);
  assert.equal(await ov.runOnce(),null);
});

test('sqlite ledger: append-only and database refuses edits',async()=>{
  const db=new TestDb(':memory:'),ledger=createSqliteLedger(db);
  await ledger.record({run:'r1',kind:'run',status:'started'});
  await ledger.record({run:'r1',kind:'video',status:'ok',sha256:'abc'});
  const rows=await ledger.read();assert.deepEqual(rows.map(r=>r.kind),['run','video']);assert.ok(rows[0].ts);
  assert.throws(()=>db.prepare("UPDATE provenance SET entry='{}'").run(),/append-only/);
  assert.throws(()=>db.prepare("DELETE FROM provenance").run(),/append-only/);
  assert.equal((await ledger.read()).length,2);db.close();
});
