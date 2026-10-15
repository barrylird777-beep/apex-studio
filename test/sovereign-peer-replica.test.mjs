import test from 'node:test';
import assert from 'node:assert/strict';
import SovereignMeshEngine, { sovereignRecordChecksum } from '../src/core/sovereign-mesh-engine.mjs';
import { readSovereignPeerReplica } from '../src/core/sovereign-peer-replica.mjs';
import { MemoryMeshCAS } from './helpers/memory-mesh-cas.mjs';

test('peer replica readback returns only the checksummed source record from its authenticated origin peer', async () => {
  const previousPeer = process.env.APEX_SOVEREIGN_PEER_ID;
  process.env.APEX_SOVEREIGN_PEER_ID = 'receiving-peer';
  const sourceRecord = {
    seq: 7,
    waveId: 'origin-wave-7',
    peerId: 'origin-peer',
    action: 'app.publish',
    timestamp: '2026-10-12T00:00:00.000Z',
    status: 'DISPATCHED',
    payload: { appId: 'planet-apex', data: { world: 'sovereign' } },
    checksum: ''
  };
  sourceRecord.checksum = sovereignRecordChecksum(sourceRecord);

  try {
    const engine = await new SovereignMeshEngine({ cas: new MemoryMeshCAS() }).ready();
    await engine.dispatchAutonomousPayload({
      waveId: 'local-receipt-7',
      peerId: 'origin-peer',
      action: 'PeerReceive',
      payload: {
        originWaveId: sourceRecord.waveId,
        sourcePeerId: 'origin-peer',
        sourceChecksum: sourceRecord.checksum,
        sourceRecord
      }
    });

    // Real receivers acknowledge the local receipt before the source asks for read-back.
    await engine.acknowledge('local-receipt-7', { storage: 'content-addressed' });

    assert.deepEqual(
      readSovereignPeerReplica(engine, { waveId: sourceRecord.waveId, checksum: sourceRecord.checksum }, { remotePeerId: 'origin-peer' }),
      { waveId: sourceRecord.waveId, checksum: sourceRecord.checksum, record: sourceRecord }
    );
    assert.throws(
      () => readSovereignPeerReplica(engine, { waveId: sourceRecord.waveId, checksum: sourceRecord.checksum }, { remotePeerId: 'impostor-peer' }),
      /verified sovereign replica not found/
    );
    assert.throws(
      () => readSovereignPeerReplica(engine, { waveId: sourceRecord.waveId, checksum: 'a'.repeat(64) }, { remotePeerId: 'origin-peer' }),
      /verified sovereign replica not found/
    );
  } finally {
    if (previousPeer === undefined) delete process.env.APEX_SOVEREIGN_PEER_ID;
    else process.env.APEX_SOVEREIGN_PEER_ID = previousPeer;
  }
});
