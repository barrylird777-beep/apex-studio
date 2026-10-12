import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SovereignMeshEngine } from '../src/core/sovereign-mesh-engine.mjs';
import { createContentAddressedPersistenceAdapter } from '../src/core/sovereign-persistence-adapter.mjs';

test('SovereignMeshEngine dispatches, acknowledges, and recovers from immutable non-WAL records', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'apex-content-store-'));
  try {
    const persistence = createContentAddressedPersistenceAdapter(root);
    const engine = new SovereignMeshEngine(root, { persistence });
    const dispatched = await engine.dispatchAutonomousPayload({
      waveId: 'adapter-test-wave',
      peerId: 'adapter-test-peer',
      action: 'AdapterContractTest',
      data: { nested: { value: 42 } }
    });

    assert.equal(dispatched.status, 'DISPATCHED');
    assert.equal(engine.get('adapter-test-wave').checksum, dispatched.checksum);
    assert.equal((await readdir(root)).length, 1);

    const acknowledged = await engine.acknowledge('adapter-test-wave', { durable: true });
    assert.equal(acknowledged.status, 'ACKNOWLEDGED');
    assert.equal((await readdir(root)).length, 2);

    const recovered = new SovereignMeshEngine(root, {
      persistence: createContentAddressedPersistenceAdapter(root)
    });
    await recovered.ready();
    assert.equal(recovered.get('adapter-test-wave').status, 'ACKNOWLEDGED');
    assert.equal(recovered.snapshot().length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
