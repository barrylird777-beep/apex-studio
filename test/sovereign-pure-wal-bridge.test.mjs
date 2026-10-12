import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import SovereignMeshEngine, { sovereignRecordChecksum } from '../src/core/sovereign-mesh-engine.mjs';
import { ApexRingWAL } from '../src/core/apex-ring-wal.mjs';
import { ApexPureStore } from '../src/core/apex-pure-store.mjs';
import { createSovereignDurableBridge } from '../src/core/sovereign-durable-bridge.mjs';

test('sovereign bridge persists a wave to Pure-WAL without a database client', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-pure-wal-bridge-'));
  const previousPeer = process.env.APEX_SOVEREIGN_PEER_ID;
  const previousRequirePeer = process.env.APEX_REQUIRE_PEER_ACK;
  process.env.APEX_SOVEREIGN_PEER_ID = 'test-peer';
  process.env.APEX_REQUIRE_PEER_ACK = 'false';
  try {
    const store = new ApexPureStore({
      root: path.join(dir, 'projects'),
      wal: new ApexRingWAL({ file: path.join(dir, 'wal', 'ring.wal.jsonl') })
    });
    const engine = new SovereignMeshEngine(path.join(dir, 'sovereign'));
    await store.init();
    await engine.ready();

    const bridge = createSovereignDurableBridge({ engine, store, workerId: 'test-worker' });
    const result = await bridge.dispatch({
      waveId: 'pure-wal-wave-1',
      action: 'test-publish',
      payload: { source: 'test' }
    });

    assert.equal(result.acknowledged.status, 'ACKNOWLEDGED');
    assert.equal(result.acknowledged.payload.acceptance.storage, 'accepted');
    assert.equal(store.jobs().length, 1);
    assert.equal(store.jobs()[0].dedupeKey, 'sovereign:pure-wal-wave-1');

    const reopened = new ApexPureStore({
      root: path.join(dir, 'projects'),
      wal: new ApexRingWAL({ file: path.join(dir, 'wal', 'ring.wal.jsonl') })
    });
    await reopened.init();
    await reopened.refreshJobs();
    assert.equal(reopened.jobs().length, 1);
    assert.equal(reopened.jobs()[0].payload.waveId, 'pure-wal-wave-1');
  } finally {
    if (previousPeer === undefined) delete process.env.APEX_SOVEREIGN_PEER_ID;
    else process.env.APEX_SOVEREIGN_PEER_ID = previousPeer;
    if (previousRequirePeer === undefined) delete process.env.APEX_REQUIRE_PEER_ACK;
    else process.env.APEX_REQUIRE_PEER_ACK = previousRequirePeer;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('bridge preserves a pending mesh record instead of faking peer acknowledgement', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'apex-peer-required-'));
  const previousPeer=process.env.APEX_SOVEREIGN_PEER_ID;
  const previousRequire=process.env.APEX_REQUIRE_PEER_ACK;
  process.env.APEX_SOVEREIGN_PEER_ID='test-peer';
  delete process.env.APEX_REQUIRE_PEER_ACK;
  try {
    const store=new ApexPureStore({root:path.join(dir,'projects'),wal:new ApexRingWAL({file:path.join(dir,'wal','ring.wal.jsonl')})});
    const engine=new SovereignMeshEngine(path.join(dir,'mesh'));
    await store.init();await engine.ready();
    const bridge=createSovereignDurableBridge({engine,store,workerId:'peer-required-test'});
    await assert.rejects(bridge.dispatch({waveId:'peer-pending-wave',action:'test',payload:{}}),/peer acknowledgement is required/);
    assert.equal(engine.get('peer-pending-wave').status,'DISPATCHED');
    assert.equal(store.jobs().length,1);
  } finally {
    if(previousPeer===undefined)delete process.env.APEX_SOVEREIGN_PEER_ID;else process.env.APEX_SOVEREIGN_PEER_ID=previousPeer;
    if(previousRequire===undefined)delete process.env.APEX_REQUIRE_PEER_ACK;else process.env.APEX_REQUIRE_PEER_ACK=previousRequire;
    await fs.rm(dir,{recursive:true,force:true});
  }
});

test('peer acknowledgement carries the checksummed payload and is persisted', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-peer-payload-'));
  const previousPeer = process.env.APEX_SOVEREIGN_PEER_ID;
  const previousRequirePeer = process.env.APEX_REQUIRE_PEER_ACK;
  process.env.APEX_SOVEREIGN_PEER_ID = 'origin-peer';
  delete process.env.APEX_REQUIRE_PEER_ACK;
  try {
    const store = new ApexPureStore({
      root: path.join(dir, 'projects'),
      wal: new ApexRingWAL({ file: path.join(dir, 'wal', 'ring.wal.jsonl') })
    });
    const engine = new SovereignMeshEngine(path.join(dir, 'sovereign'));
    await store.init();
    await engine.ready();
    const sent = [];
    let sourceRecord;
    const bridge = createSovereignDurableBridge({
      engine,
      store,
      workerId: 'payload-test',
      peerNode: {},
      peerAddress: '/ip4/127.0.0.1/tcp/9000/p2p/remote-peer',
      sendPeer: async (_node, address, envelope) => {
        sent.push({ address, envelope });
        if (envelope.type === 'durable.accept') {
          sourceRecord = envelope.record;
          return { accepted: true, peerId: 'remote-peer' };
        }
        if (envelope.type === 'durable.read') {
          return { accepted: true, peerId: 'remote-peer', replica: {
            waveId: envelope.waveId, checksum: envelope.checksum, record: sourceRecord
          } };
        }
        throw new Error('unexpected peer envelope type');
      }
    });
    const result = await bridge.dispatch({
      waveId: 'payload-wave-1',
      action: 'app.publish',
      payload: { appId: 'kernelodies', data: { trackId: 'track-1' } }
    });
    assert.equal(sent[0].envelope.type, 'durable.accept');
    assert.equal(sent[0].envelope.record.waveId, 'payload-wave-1');
    assert.equal(sent[0].envelope.record.status, 'DISPATCHED');
    assert.equal(sent[0].envelope.record.checksum, sent[0].envelope.checksum);
    assert.equal(sent[1].envelope.type, 'durable.read');
    assert.equal(sent[1].envelope.waveId, 'payload-wave-1');
    assert.equal(result.acknowledged.payload.acceptance.peer.replicaVerified, true);
    assert.equal(result.acknowledged.status, 'ACKNOWLEDGED');
    const ack = await store.get('sovereign_peer_acks', 'payload-wave-1');
    assert.equal(ack.peerId, 'remote-peer');
    assert.equal(ack.checksum, sent.envelope.checksum);
  } finally {
    if (previousPeer === undefined) delete process.env.APEX_SOVEREIGN_PEER_ID;
    else process.env.APEX_SOVEREIGN_PEER_ID = previousPeer;
    if (previousRequirePeer === undefined) delete process.env.APEX_REQUIRE_PEER_ACK;
    else process.env.APEX_REQUIRE_PEER_ACK = previousRequirePeer;
    await fs.rm(dir, { recursive: true, force: true });
  }
});



test('KashKorner ledger excludes opportunity records without deleting them from the sovereign namespace', async () => {
  const { excludeOpportunityRecords } = await import('../src/apps/kash-korner.mjs');
  const rows = [
    { id: 'cash-1', record: { id: 'cash-1', recordType: 'transaction', amount: 12, currency: 'USD' } },
    { id: 'opportunity-1', record: { id: 'opportunity-1', recordType: 'opportunity', estimated_net_profit_usd: 4.2 } },
    { id: 'cash-2', record: { id: 'cash-2', recordType: 'transaction', amount: -3, currency: 'USD' } }
  ];
  assert.deepEqual(excludeOpportunityRecords(rows), [
    { id: 'cash-1', recordType: 'transaction', amount: 12, currency: 'USD' },
    { id: 'cash-2', recordType: 'transaction', amount: -3, currency: 'USD' }
  ]);
  assert.equal(rows[1].record.recordType, 'opportunity', 'filtering the ledger must not delete opportunity data');
});


test('local PeerReceive records are acknowledged in Pure-WAL and excluded from peer reconciliation', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-peer-receipt-loop-'));
  const store = new ApexPureStore({
    root: path.join(dir, 'projects'),
    wal: new ApexRingWAL({ file: path.join(dir, 'wal', 'ring.wal.jsonl') })
  });
  const engine = new SovereignMeshEngine(path.join(dir, 'sovereign'));
  try {
    await store.init();
    await engine.ready();
    await engine.dispatchAutonomousPayload({
      waveId: 'local-peer-receive-wave',
      peerId: 'remote-peer',
      action: 'PeerReceive',
      payload: { originWaveId: 'source-wave', sourcePeerId: 'remote-peer' }
    });

    const { acknowledgePendingLocalPeerReceives } = await import('../src/core/sovereign-peer-receipts.mjs');
    assert.equal(await acknowledgePendingLocalPeerReceives(engine), 1);
    assert.equal(engine.get('local-peer-receive-wave').status, 'ACKNOWLEDGED');

    const reopenedEngine = new SovereignMeshEngine(path.join(dir, 'sovereign'));
    await reopenedEngine.ready();
    assert.equal(reopenedEngine.get('local-peer-receive-wave').waveId, 'local-peer-receive-wave');
    assert.equal(reopenedEngine.get('local-peer-receive-wave').status, 'ACKNOWLEDGED');

    const bridge = createSovereignDurableBridge({ engine, store, workerId: 'receipt-loop-guard' });
    const result = await bridge.reconcile();
    assert.equal(result.scanned, 0);
    assert.equal(result.persisted, 0);
    assert.equal(result.failed, 0);
    assert.deepEqual(store.jobs(), []);
    assert.equal(await acknowledgePendingLocalPeerReceives(engine), 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});


test('legacy mesh migration preserves the sequence counter without continuing WAL writes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-mesh-sequence-migration-'));
  try {
    const storageDir = path.join(dir, 'sovereign');
    await fs.mkdir(storageDir, { recursive: true });
    const legacy = {
      seq: 7,
      waveId: 'legacy-wave-7',
      peerId: 'legacy-peer',
      action: 'LegacyReceipt',
      timestamp: new Date().toISOString(),
      status: 'ACKNOWLEDGED',
      payload: { legacy: true }
    };
    legacy.checksum = sovereignRecordChecksum(legacy);
    await fs.writeFile(path.join(storageDir, 'apex-ring-wal.ndjson'), JSON.stringify(legacy) + '\n', { mode: 0o600 });

    const engine = new SovereignMeshEngine(storageDir);
    await engine.ready();
    assert.equal(engine.get('legacy-wave-7').seq, 7);
    const next = await engine.dispatchAutonomousPayload({
      waveId: 'new-wave-after-migration',
      peerId: 'new-peer',
      action: 'MigrationSequenceCheck',
      payload: { migrated: true }
    });
    assert.equal(next.seq, 8);
    assert.equal(await fs.readFile(path.join(storageDir, 'apex-ring-wal.ndjson'), 'utf8'), JSON.stringify(legacy) + '\n');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
