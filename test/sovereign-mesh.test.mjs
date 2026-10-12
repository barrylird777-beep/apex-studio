import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import SovereignMeshEngine, { sovereignRecordChecksum } from '../src/core/sovereign-mesh-engine.mjs';

test('sovereign content-addressed state persists without a WAL, deduplicates, and recovers', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-sovereign-'));
  const previousPeer = process.env.APEX_SOVEREIGN_PEER_ID;
  process.env.APEX_SOVEREIGN_PEER_ID = 'test-peer';

  try {
    const engine = new SovereignMeshEngine(dir);
    await engine.ready();

    const first = await engine.dispatchAutonomousPayload({
      waveId: 'wave-1',
      action: 'test',
      payload: { b: 2, a: 1 }
    });

    const duplicate = await engine.dispatchAutonomousPayload({
      waveId: 'wave-1',
      action: 'should-not-replace'
    });

    assert.equal(duplicate.seq, first.seq);
    assert.equal(engine.size, 1);
    await assert.rejects(fs.access(path.join(dir, 'apex-ring-wal.ndjson')), { code: 'ENOENT' });

    const recovered = new SovereignMeshEngine(dir);
    await recovered.ready();

    assert.equal(recovered.size, 1);
    assert.equal(recovered.get('wave-1').checksum, first.checksum);

    const second = await recovered.dispatchAutonomousPayload({
      waveId: 'wave-2',
      action: 'test'
    });
    assert.equal(second.seq, first.seq + 1);
    assert.equal(recovered.size, 2);
  } finally {
    if (previousPeer === undefined) delete process.env.APEX_SOVEREIGN_PEER_ID;
    else process.env.APEX_SOVEREIGN_PEER_ID = previousPeer;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('sovereign content-addressed objects reject tampering during recovery', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-sovereign-tamper-'));
  const previousPeer = process.env.APEX_SOVEREIGN_PEER_ID;
  process.env.APEX_SOVEREIGN_PEER_ID = 'test-peer';

  try {
    const engine = new SovereignMeshEngine(dir);
    await engine.ready();
    await engine.dispatchAutonomousPayload({
      waveId: 'wave-tamper',
      action: 'test'
    });

    const manifest = await engine.cas.readRef("waves", engine.key("wave-tamper"));
    const objectFile = engine.cas.objectPath(manifest.hash);
    const raw = await fs.readFile(objectFile, "utf8");
    await fs.writeFile(objectFile, raw.replace("wave-tamper", "wave-tampered"), "utf8");

    const recovered = new SovereignMeshEngine(dir);
    await assert.rejects(recovered.ready(), /integrity verification failed/);
  } finally {
    if (previousPeer === undefined) delete process.env.APEX_SOVEREIGN_PEER_ID;
    else process.env.APEX_SOVEREIGN_PEER_ID = previousPeer;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('replicated peer events retain the verified source record across restart', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-sovereign-replica-'));
  const previousPeer = process.env.APEX_SOVEREIGN_PEER_ID;
  process.env.APEX_SOVEREIGN_PEER_ID = 'replica-peer';
  const sourceRecord = {
    seq: 41,
    waveId: 'origin-wave-41',
    peerId: 'origin-peer',
    action: 'app.publish',
    timestamp: '2026-10-12T00:00:00.000Z',
    status: 'DISPATCHED',
    payload: { appId: 'PlanetApeX', data: { sovereignty: true } },
    checksum: ''
  };
  sourceRecord.checksum = sovereignRecordChecksum(sourceRecord);

  try {
    const first = new SovereignMeshEngine(dir);
    await first.ready();
    await first.dispatchAutonomousPayload({
      waveId: 'peer-origin-wave-41',
      peerId: 'origin-peer',
      action: 'PeerReceive',
      payload: {
        originWaveId: sourceRecord.waveId,
        sourcePeerId: 'origin-peer',
        sourceRecord
      }
    });

    const recovered = new SovereignMeshEngine(dir);
    await recovered.ready();
    assert.deepEqual(recovered.get('peer-origin-wave-41').payload.payload.sourceRecord, sourceRecord);
  } finally {
    if (previousPeer === undefined) delete process.env.APEX_SOVEREIGN_PEER_ID;
    else process.env.APEX_SOVEREIGN_PEER_ID = previousPeer;
    await fs.rm(dir, { recursive: true, force: true });
  }
});


test('legacy mesh migration replays multiple newline-delimited records without losing history', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-sovereign-legacy-multiline-'));
  const first = {
    seq: 1, waveId: 'legacy-wave-1', peerId: 'legacy-peer',
    action: 'legacy.import', timestamp: '2026-10-01T00:00:00.000Z',
    status: 'DISPATCHED', payload: { legacy: true, index: 1 }
  };
  first.checksum = sovereignRecordChecksum(first);
  const second = {
    seq: 2, waveId: 'legacy-wave-2', peerId: 'legacy-peer',
    action: 'legacy.import', timestamp: '2026-10-01T00:00:01.000Z',
    status: 'DISPATCHED', payload: { legacy: true, index: 2 }
  };
  second.checksum = sovereignRecordChecksum(second);
  try {
    await fs.writeFile(path.join(dir, 'apex-ring-wal.ndjson'), JSON.stringify(first) + '\n' + JSON.stringify(second) + '\n', { mode: 0o600 });
    const engine = new SovereignMeshEngine(dir);
    await engine.ready();
    assert.equal(engine.size, 2);
    assert.deepEqual(engine.get('legacy-wave-1'), first);
    assert.deepEqual(engine.get('legacy-wave-2'), second);
    const recovered = new SovereignMeshEngine(dir);
    await recovered.ready();
    assert.equal(recovered.size, 2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
