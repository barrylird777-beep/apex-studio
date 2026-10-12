import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ApexPureStore } from '../src/core/apex-pure-store.mjs';
import { ApexRingWAL } from '../src/core/apex-ring-wal.mjs';
import { createPureStore } from '../src/core/apex-pure-store.mjs';

test('Pure-WAL store rejects traversal collection names before writing outside root', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'apex-pure-path-'));
  try {
    const root=path.join(dir,'projects');
    const store=new ApexPureStore({root,wal:new ApexRingWAL({file:path.join(dir,'wal','ring.wal.jsonl')})});
    await assert.rejects(store.put('..','escaped',{secret:true}),/SECURITY_VIOLATION/);
    await assert.rejects(store.put('safe','..',{secret:true}),/SECURITY_VIOLATION/);
    await assert.rejects(store.put('../outside','x',{secret:true}),/SECURITY_VIOLATION/);
    await assert.rejects(fs.access(path.join(dir,'escaped.json')));
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});

test('Pure-WAL store rejects symlinked collection and target paths', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'apex-pure-symlink-'));
  try {
    const root=path.join(dir,'projects'),outside=path.join(dir,'outside');
    await fs.mkdir(root,{recursive:true});await fs.mkdir(outside,{recursive:true});
    await fs.symlink(outside,path.join(root,'linked'),'dir');
    const store=new ApexPureStore({root,wal:new ApexRingWAL({file:path.join(dir,'wal','ring.wal.jsonl')})});
    await assert.rejects(store.put('linked','record',{secret:true}),/SECURITY_VIOLATION/);
    await fs.writeFile(path.join(outside,'record.json'),'{}');
    await fs.mkdir(path.join(root,'safe'));
    await fs.symlink(path.join(outside,'record.json'),path.join(root,'safe','linked.json'));
    await assert.rejects(store.put('safe','linked',{secret:true}),/SECURITY_VIOLATION/);
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});

test('legacy PureStore rejects absolute and parent-traversal paths', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'apex-legacy-path-'));
  try {
    const store=createPureStore({root:path.join(dir,'root')});
    await assert.rejects(store.write('../escape.json',{bad:true}),/SECURITY_VIOLATION/);
    await assert.rejects(store.write(path.join(dir,'absolute.json'),{bad:true}),/SECURITY_VIOLATION/);
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});

test('Pure-WAL materialized records are written with restrictive permissions and reopened from WAL', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'apex-pure-durable-'));
  try {
    const root=path.join(dir,'projects'),walFile=path.join(dir,'wal','ring.wal.jsonl');
    const store=new ApexPureStore({root,wal:new ApexRingWAL({file:walFile})});
    await store.put('notes','note-1',{value:'durable'});
    const file=path.join(root,'notes','note-1.json');
    assert.equal((await fs.stat(file)).isFile(),true);
    assert.equal((await fs.stat(file)).mode & 0o777,0o600);
    const reopened=new ApexPureStore({root,wal:new ApexRingWAL({file:walFile})});
    await reopened.init();
    assert.equal((await reopened.get('notes','note-1')).value,'durable');
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});

test('independent WAL instances serialize concurrent appends into one verified chain', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'apex-wal-concurrency-'));
  try {
    const file=path.join(dir,'ring.wal.jsonl');
    const a=new ApexRingWAL({file}),b=new ApexRingWAL({file});
    await Promise.all(Array.from({length:24},(_,i)=>(i%2?a:b).append('concurrent',{index:i})));
    const reopened=new ApexRingWAL({file});
    const records=[];
    assert.equal(await reopened.replay({onRecord:r=>records.push(r)}),24);
    assert.deepEqual(records.map(r=>r.seq),Array.from({length:24},(_,i)=>i+1));
    assert.equal(new Set(records.map(r=>r.hash)).size,24);
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});

test('WAL refuses a symlinked log file instead of following it', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'apex-wal-symlink-'));
  try {
    const outside=path.join(dir,'outside.wal');
    const target=path.join(dir,'ring.wal.jsonl');
    await fs.writeFile(outside,'','utf8');
    await fs.symlink(outside,target);
    const wal=new ApexRingWAL({file:target});
    await assert.rejects(wal.init(),/SECURITY_VIOLATION/);
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});

test('independent Pure-WAL store instances observe each other’s durable records', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'apex-pure-shared-state-'));
  try {
    const root=path.join(dir,'projects'),file=path.join(dir,'wal','ring.wal.jsonl');
    const a=new ApexPureStore({root,wal:new ApexRingWAL({file})});
    const b=new ApexPureStore({root,wal:new ApexRingWAL({file})});
    await Promise.all([
      a.put('shared','record-a',{writer:'a'}),
      b.put('shared','record-b',{writer:'b'})
    ]);
    assert.equal((await a.get('shared','record-b')).writer,'b');
    assert.equal((await b.get('shared','record-a')).writer,'a');
    assert.equal((await a.list('shared')).length,2);
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
