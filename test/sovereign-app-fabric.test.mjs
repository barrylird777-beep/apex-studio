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
import { drainSovereignAppDispatchQueue } from '../src/core/sovereign-app-dispatch-queue.mjs';
import { savePlanetApexRecord, getPlanetApexRecord } from '../src/apps/planet-apex.mjs';
import { saveKoBlocksRecord, getKoBlocksRecord } from '../src/apps/ko-blocks.mjs';
import { saveKernelVisionRecord, getKernelVisionRecord } from '../src/apps/kernel-vision.mjs';
import { saveKoinKobRecord, getKoinKobRecord } from '../src/apps/koin-kob.mjs';
import { saveKashKornerRecord, getKashKornerRecord } from '../src/apps/kash-korner.mjs';
import { saveKernelodiesRecord, getKernelodiesRecord } from '../src/apps/kernelodies.mjs';


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

test('phone dispatch is durably queued and the runtime daemon alone writes the mesh WAL', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'apex-phone-sovereign-'));
  const prior=process.env.APEX_SOVEREIGN_PEER_ID;
  delete process.env.APEX_SOVEREIGN_PEER_ID;
  try {
    const store=new ApexPureStore({root:path.join(dir,'projects'),wal:new ApexRingWAL({file:path.join(dir,'wal','ring.wal.jsonl')})});
    const fabric=createSovereignAppFabric({store});
    const queued=await fabric.dispatch({appId:'kernelodies',waveId:'phone-wave-1',action:'phone.test',data:{origin:'iphone'}});
    assert.equal(queued.accepted,true);
    assert.equal(queued.durable,true);
    assert.equal(queued.queued,true);
    assert.equal(queued.peerPending,true);
    assert.equal(queued.status,'queued');
    assert.equal(store.jobs().some(job=>job.id===queued.jobId&&job.type==='sovereign.app.dispatch'),true);
    assert.equal((await store.claim({workerId:'generic-worker',limit:8})).length,0,'generic workers must not steal sovereign dispatches');

    const engine=new SovereignMeshEngine(path.join(dir,'mesh'));
    await engine.ready();
    const drained=await drainSovereignAppDispatchQueue({store,engine,peerId:'test-peer',workerId:'test-runtime'});
    assert.equal(drained.dispatched,1);
    const record=engine.get('phone-wave-1');
    assert.equal(record.peerId,'test-peer');
    assert.equal(record.payload.payload.appId,'kernelodies');
    assert.equal(record.payload.payload.source,'phone-control-plane');
    assert.match(record.checksum,/^[a-f0-9]{64}$/);
    assert.equal(store.jobs().find(job=>job.id===queued.jobId).status,'completed');
    const retry=await fabric.dispatch({appId:'kernelodies',waveId:'phone-wave-1',action:'phone.test',data:{origin:'iphone'}});
    assert.equal(retry.duplicate,true,'retries must reuse the original durable dispatch');
    assert.equal(retry.status,'completed');
    assert.equal(store.jobs().filter(job=>job.type==='sovereign.app.dispatch').length,1,'one wave must never create duplicate dispatch jobs');
  } finally {
    if(prior===undefined)delete process.env.APEX_SOVEREIGN_PEER_ID;else process.env.APEX_SOVEREIGN_PEER_ID=prior;
    await fs.rm(dir,{recursive:true,force:true});
  }
});
