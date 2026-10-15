import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import SovereignMeshEngine, { sovereignRecordChecksum } from '../src/core/sovereign-mesh-engine.mjs';
import { createHash } from 'node:crypto';
import { encodeCanonical } from '../src/core/apex-cbor.mjs';
import { ApexRingWAL } from '../src/core/apex-ring-wal.mjs';
import { ApexPureStore } from '../src/core/apex-pure-store.mjs';
import { createSovereignDurableBridge } from '../src/core/sovereign-durable-bridge.mjs';

// Test-only CAS adapter. It is intentionally in-memory and is not a production
// durability implementation; these bridge tests exercise bridge behavior only.
const testCasByRoot = new Map();
function createTestCas(root) {
  let refs = testCasByRoot.get(root);
  if (!refs) {
    refs = new Map();
    testCasByRoot.set(root, refs);
  }
  const hash = value => createHash('sha256').update(encodeCanonical(value)).digest('hex');
  return {
    async init() {},
    async readRef(namespace, key) {
      const entry = refs.get(namespace + '\\0' + key);
      return entry ? { ...entry } : null;
    },
    async writeRef(namespace, key, value, { expectedHash } = {}) {
      const id = namespace + '\\0' + key;
      const current = refs.get(id);
      if ((current?.hash ?? null) !== (expectedHash ?? null)) {
        const error = new Error('test CAS conflict');
        error.code = 'CAS_CONFLICT';
        throw error;
      }
      const entry = { value, hash: hash(value) };
      refs.set(id, entry);
      return { ...entry };
    },
    async listRefs(namespace) {
      const prefix = namespace + '\\0';
      return [...refs.entries()]
        .filter(([id]) => id.startsWith(prefix))
        .map(([id, entry]) => ({ key: id.slice(prefix.length), ...entry }));
    }
  };
}


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
    const engine = new SovereignMeshEngine({ cas: createTestCas(path.join(dir, 'sovereign')) });
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
    const engine=new SovereignMeshEngine({ cas: createTestCas(path.join(dir, 'sovereign')) });
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
    const engine = new SovereignMeshEngine({ cas: createTestCas(path.join(dir, 'sovereign')) });
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
    assert.equal(ack.checksum, sent[0].envelope.checksum);
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
  const engine = new SovereignMeshEngine({ cas: createTestCas(path.join(dir, 'sovereign')) });
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

    const reopenedEngine = new SovereignMeshEngine({ cas: createTestCas(path.join(dir, 'sovereign')) });
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


test('mesh engine refuses legacy filesystem persistence without an injected peer CAS', async () => {
  assert.throws(
    () => new SovereignMeshEngine('/legacy/sovereign'),
    /verified peer-backed CAS; local fallback is forbidden/
  );
});

test('bridge leaves a wave unacknowledged when peer replica readback fails', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-peer-readback-fail-'));
  const previousPeer = process.env.APEX_SOVEREIGN_PEER_ID;
  const previousRequirePeer = process.env.APEX_REQUIRE_PEER_ACK;
  process.env.APEX_SOVEREIGN_PEER_ID = 'origin-peer';
  delete process.env.APEX_REQUIRE_PEER_ACK;
  try {
    const store = new ApexPureStore({
      root: path.join(dir, 'projects'),
      wal: new ApexRingWAL({ file: path.join(dir, 'wal', 'ring.wal.jsonl') })
    });
    const engine = new SovereignMeshEngine({ cas: createTestCas(path.join(dir, 'sovereign')) });
    await store.init();
    await engine.ready();
    const bridge = createSovereignDurableBridge({
      engine,
      store,
      workerId: 'readback-fail-test',
      peerNode: {},
      peerAddress: '/ip4/127.0.0.1/tcp/9000/p2p/remote-peer',
      sendPeer: async (_node, _address, envelope) => envelope.type === 'durable.accept'
        ? { accepted: true, peerId: 'remote-peer' }
        : { accepted: true, peerId: 'remote-peer', replica: null }
    });

    await assert.rejects(
      bridge.dispatch({ waveId: 'readback-fail-wave', action: 'app.publish', payload: { appId: 'planet-apex', data: { private: true } } }),
      /failed verified replica read-back/
    );
    assert.equal(engine.get('readback-fail-wave').status, 'DISPATCHED');
    assert.equal(await store.get('sovereign_peer_acks', 'readback-fail-wave'), null);
  } finally {
    if (previousPeer === undefined) delete process.env.APEX_SOVEREIGN_PEER_ID;
    else process.env.APEX_SOVEREIGN_PEER_ID = previousPeer;
    if (previousRequirePeer === undefined) delete process.env.APEX_REQUIRE_PEER_ACK;
    else process.env.APEX_REQUIRE_PEER_ACK = previousRequirePeer;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
