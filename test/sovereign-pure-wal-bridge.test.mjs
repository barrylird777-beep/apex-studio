import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import SovereignMeshEngine from '../src/core/sovereign-mesh-engine.mjs';
import { ApexRingWAL } from '../src/core/apex-ring-wal.mjs';
import { ApexPureStore } from '../src/core/apex-pure-store.mjs';
import { createSovereignDurableBridge } from '../src/core/sovereign-durable-bridge.mjs';

test('sovereign bridge persists a wave to Pure-WAL without a database client', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-pure-wal-bridge-'));
  const previousPeer = process.env.APEX_SOVEREIGN_PEER_ID;
  process.env.APEX_SOVEREIGN_PEER_ID = 'test-peer';
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
    assert.equal(reopened.jobs().length, 1);
    assert.equal(reopened.jobs()[0].payload.waveId, 'pure-wal-wave-1');
  } finally {
    if (previousPeer === undefined) delete process.env.APEX_SOVEREIGN_PEER_ID;
    else process.env.APEX_SOVEREIGN_PEER_ID = previousPeer;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
