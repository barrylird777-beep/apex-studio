import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import SovereignMeshEngine from '../src/core/sovereign-mesh-engine.mjs';

test('sovereign WAL persists, deduplicates, and recovers', async () => {
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

    const recovered = new SovereignMeshEngine(dir);
    await recovered.ready();

    assert.equal(recovered.size, 1);
    assert.equal(recovered.get('wave-1').checksum, first.checksum);

    await assert.rejects(
      recovered.dispatchAutonomousPayload({
        waveId: 'wave-2',
        action: 'test'
      }),
      /WAL recovery|No sovereign/
    );
  } finally {
    if (previousPeer === undefined) delete process.env.APEX_SOVEREIGN_PEER_ID;
    else process.env.APEX_SOVEREIGN_PEER_ID = previousPeer;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('sovereign WAL rejects tampering during recovery', async () => {
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

    const wal = path.join(dir, 'apex-ring-wal.ndjson');
    const raw = await fs.readFile(wal, 'utf8');
    const tampered = raw.replace('wave-tamper', 'wave-tampered');
    await fs.writeFile(wal, tampered, 'utf8');

    const recovered = new SovereignMeshEngine(dir);
    await assert.rejects(recovered.ready(), /checksum mismatch/);
  } finally {
    if (previousPeer === undefined) delete process.env.APEX_SOVEREIGN_PEER_ID;
    else process.env.APEX_SOVEREIGN_PEER_ID = previousPeer;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
