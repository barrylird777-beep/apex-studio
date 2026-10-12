import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import SovereignMeshEngine from '../src/core/sovereign-mesh-engine.mjs';

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
    checksum: 'verified-at-ingress'
  };

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
    assert.deepEqual(recovered.get('peer-origin-wave-41').payload.sourceRecord, sourceRecord);
  } finally {
    if (previousPeer === undefined) delete process.env.APEX_SOVEREIGN_PEER_ID;
    else process.env.APEX_SOVEREIGN_PEER_ID = previousPeer;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
