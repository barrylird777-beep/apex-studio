import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { encodeCanonical } from '../src/core/apex-cbor.mjs';
import { PeerMeshCasAdapter } from '../src/core/peer-mesh-cas-adapter.mjs';
import SovereignMeshEngine, { verifySovereignRecord } from '../src/core/sovereign-mesh-engine.mjs';
import { createSovereignDurableBridge } from '../src/core/sovereign-durable-bridge.mjs';

// The engine requires an explicit peer identity even in volatile contract tests.
if (!process.env.APEX_SOVEREIGN_PEER_ID) process.env.APEX_SOVEREIGN_PEER_ID = 'peer-cas-contract-test';

// Volatile contract fixture only. It is never used as a production storage backend.
class MemoryPeerRefs {
  constructor(namespace = 'kernelvision') { this.namespace = namespace; this.refs = new Map(); }
  hash(value) { return createHash('sha256').update(encodeCanonical(value)).digest('hex'); }
  async listRefs() {
    return [...this.refs.values()].map(ref => structuredClone({ namespace: this.namespace, ...ref }));
  }
  async readRef(key) {
    const ref = this.refs.get(key);
    return ref ? structuredClone({ value: ref.value, hash: ref.hash }) : null;
  }
  async writeRef(key, value, { expectedHash = null } = {}) {
    const current = this.refs.get(key);
    if ((current?.hash ?? null) !== expectedHash) {
      const error = new Error('compare-and-swap conflict');
      error.code = 'CAS_CONFLICT';
      throw error;
    }
    const hash = this.hash(value);
    this.refs.set(key, { key, value: structuredClone(value), hash });
    return { hash };
  }
}

async function fixture() {
  const peerRefs = new MemoryPeerRefs();
  const store = new PeerMeshCasAdapter({ store: peerRefs, appNamespace: 'kernelvision' });
  const engine = new SovereignMeshEngine({ cas: store });
  await engine.ready();
  return { peerRefs, store, engine };
}

test('peer-only bridge dispatches through injected CAS and verifies checksums', async () => {
  const { store, engine } = await fixture();
  const previous = process.env.APEX_REQUIRE_PEER_ACK;
  process.env.APEX_REQUIRE_PEER_ACK = 'false';
  try {
    const bridge = createSovereignDurableBridge({ engine, store, workerId: 'peer-cas-test' });
    const result = await bridge.dispatch({
      waveId: 'peer-cas-wave-1', action: 'app.publish',
      payload: { appId: 'kernelodies', trackId: 'track-1' }
    });
    assert.equal(result.acknowledged.status, 'ACKNOWLEDGED');
    assert.equal(verifySovereignRecord(result.acknowledged), true);
    assert.equal(store.jobs().length, 1);
    assert.equal(store.jobs()[0].dedupeKey, 'sovereign:peer-cas-wave-1');
    assert.equal((await store.get('sovereign_peer_acks', 'peer-cas-wave-1')), null);
  } finally {
    if (previous === undefined) delete process.env.APEX_REQUIRE_PEER_ACK;
    else process.env.APEX_REQUIRE_PEER_ACK = previous;
  }
});

test('bridge requires an authenticated peer acknowledgement by default', async () => {
  const { store, engine } = await fixture();
  const previous = process.env.APEX_REQUIRE_PEER_ACK;
  delete process.env.APEX_REQUIRE_PEER_ACK;
  try {
    const bridge = createSovereignDurableBridge({ engine, store, workerId: 'peer-required-test' });
    await assert.rejects(
      bridge.dispatch({ waveId: 'peer-pending-wave', action: 'test', payload: {} }),
      /peer acknowledgement is required/
    );
    assert.equal(engine.get('peer-pending-wave').status, 'DISPATCHED');
    assert.equal(store.jobs().length, 1);
  } finally {
    if (previous === undefined) delete process.env.APEX_REQUIRE_PEER_ACK;
    else process.env.APEX_REQUIRE_PEER_ACK = previous;
  }
});

test('bridge only acknowledges after peer checksum and replica read-back verification', async () => {
  const { store, engine } = await fixture();
  const previousPeer = process.env.APEX_SOVEREIGN_PEER_ID;
  const previousRequire = process.env.APEX_REQUIRE_PEER_ACK;
  process.env.APEX_SOVEREIGN_PEER_ID = 'origin-peer';
  delete process.env.APEX_REQUIRE_PEER_ACK;
  try {
    let sourceRecord;
    const bridge = createSovereignDurableBridge({
      engine, store, workerId: 'peer-readback-test', peerNode: {},
      peerAddress: '/ip4/127.0.0.1/tcp/9000/p2p/remote-peer',
      sendPeer: async (_node, _address, envelope) => {
        if (envelope.type === 'durable.accept') {
          sourceRecord = envelope.record;
          return { accepted: true, peerId: 'remote-peer' };
        }
        return { accepted: true, peerId: 'remote-peer', replica: {
          waveId: envelope.waveId, checksum: envelope.checksum, record: sourceRecord
        } };
      }
    });
    const result = await bridge.dispatch({
      waveId: 'peer-readback-wave', action: 'app.publish', payload: { appId: 'planetapex' }
    });
    assert.equal(result.acknowledged.status, 'ACKNOWLEDGED');
    assert.equal(result.acknowledged.payload.acceptance.peer.replicaVerified, true);
    assert.equal(verifySovereignRecord(sourceRecord), true);
    assert.equal((await store.get('sovereign_peer_acks', 'peer-readback-wave')).peerId, 'remote-peer');
  } finally {
    if (previousPeer === undefined) delete process.env.APEX_SOVEREIGN_PEER_ID;
    else process.env.APEX_SOVEREIGN_PEER_ID = previousPeer;
    if (previousRequire === undefined) delete process.env.APEX_REQUIRE_PEER_ACK;
    else process.env.APEX_REQUIRE_PEER_ACK = previousRequire;
  }
});

test('peer adapter rejects a stale compare-and-swap update', async () => {
  const { store } = await fixture();
  await store.put('app_state', 'record-1', { value: 'first' });
  const current = await store.readRef('state', 'app_state/record-1');
  await store.writeRef('state', 'app_state/record-1', { value: 'second' }, { expectedHash: current.hash });
  await assert.rejects(
    store.writeRef('state', 'app_state/record-1', { value: 'stale' }, { expectedHash: current.hash }),
    error => error.code === 'CAS_CONFLICT'
  );
});
