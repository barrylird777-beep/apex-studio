import test from 'node:test';
import assert from 'node:assert/strict';
import { SovereignMeshEngine } from '../src/core/sovereign-mesh-engine.mjs';

function memoryPersistence(seed = []) {
  const records = seed.map((record) => structuredClone(record));
  return {
    records,
    async load() { return records.map((record) => structuredClone(record)); },
    async append(record) { records.push(structuredClone(record)); }
  };
}

test('SovereignMeshEngine supports injected non-WAL persistence and recovery', async () => {
  const persistence = memoryPersistence();
  const engine = new SovereignMeshEngine('/unused-test-path', { persistence });
  const dispatched = await engine.dispatchAutonomousPayload({
    waveId: 'adapter-test-wave',
    peerId: 'adapter-test-peer',
    action: 'AdapterContractTest',
    data: { nested: { value: 42 } }
  });

  assert.equal(dispatched.status, 'DISPATCHED');
  assert.equal(persistence.records.length, 1);
  assert.equal(engine.get('adapter-test-wave').checksum, dispatched.checksum);

  const acknowledged = await engine.acknowledge('adapter-test-wave', { durable: true });
  assert.equal(acknowledged.status, 'ACKNOWLEDGED');
  assert.equal(persistence.records.length, 2);

  const recovered = new SovereignMeshEngine('/unused-test-path', {
    persistence: memoryPersistence(persistence.records)
  });
  await recovered.ready();
  assert.equal(recovered.get('adapter-test-wave').status, 'ACKNOWLEDGED');
  assert.equal(recovered.snapshot().length, 1);
});
