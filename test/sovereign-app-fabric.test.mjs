import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { APEX_APPS } from '../src/apps/apex-six-apps.mjs';
import { ApexPureStore } from '../src/core/apex-pure-store.mjs';
import { ApexRingWAL } from '../src/core/apex-ring-wal.mjs';
import SovereignMeshEngine from '../src/core/sovereign-mesh-engine.mjs';
import { createSovereignAppFabric } from '../src/core/sovereign-app-fabric.mjs';

test('one Pure-WAL fabric gives all six canonical apps isolated durable namespaces', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'apex-six-app-fabric-'));
  try {
    const store=new ApexPureStore({root:path.join(dir,'projects'),wal:new ApexRingWAL({file:path.join(dir,'wal','ring.wal.jsonl')})});
    const fabric=createSovereignAppFabric({store,engineFactory:()=>new SovereignMeshEngine(path.join(dir,'mesh'))});
    const apps=fabric.apps();
    assert.equal(apps.length,6);
    assert.deepEqual(new Set(apps.map(app=>app.id)),new Set(Object.values(APEX_APPS).map(app=>app.id)));
    for(const app of apps){
      const saved=await fabric.put(app.id,'smoke-record',{proof:'durable',app:app.id});
      assert.equal(saved.durable,true);
      assert.equal(saved.record.appId,app.id);
      const read=await fabric.get(app.id,'smoke-record');
      assert.equal(read.record.proof,'durable');
      assert.equal((await fabric.list(app.id)).length,1);
    }
    const status=await fabric.status();
    assert.equal(status.ok,true);
    assert.equal(status.storage,'local-pure-wal');
    assert.equal(status.canonicalAppCount,6);
    assert.equal(new Set((await fabric.list('planet-apex')).map(x=>x.id)).size,1);
    await assert.rejects(fabric.put('unknown-app','x',{value:1}),/Unknown canonical Apex app/);
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});

test('phone-triggered sovereign dispatch is fail-closed until peer identity is configured', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'apex-phone-sovereign-'));
  const prior=process.env.APEX_SOVEREIGN_PEER_ID;
  delete process.env.APEX_SOVEREIGN_PEER_ID;
  try {
    const fabric=createSovereignAppFabric({
      store:new ApexPureStore({root:path.join(dir,'projects'),wal:new ApexRingWAL({file:path.join(dir,'wal','ring.wal.jsonl')})}),
      engineFactory:()=>new SovereignMeshEngine(path.join(dir,'mesh'))
    });
    await assert.rejects(fabric.dispatch({appId:'planet-apex',action:'test',data:{}}),/peer identity is not configured/);
    process.env.APEX_SOVEREIGN_PEER_ID='test-peer';
    const accepted=await fabric.dispatch({appId:'kernelodies',waveId:'phone-wave-1',action:'phone.test',data:{origin:'iphone'}});
    assert.equal(accepted.accepted,true);
    assert.equal(accepted.appId,'kernelodies');
    assert.equal(accepted.waveId,'phone-wave-1');
    assert.match(accepted.checksum,/^[a-f0-9]{64}$/);
  } finally {
    if(prior===undefined)delete process.env.APEX_SOVEREIGN_PEER_ID;else process.env.APEX_SOVEREIGN_PEER_ID=prior;
    await fs.rm(dir,{recursive:true,force:true});
  }
});
