import test from 'node:test';
import assert from 'node:assert/strict';
import SovereignMeshEngine from '../src/core/sovereign-mesh-engine.mjs';
import { MemoryMeshCAS } from './helpers/memory-mesh-cas.mjs';

test('peer-only mesh persists, deduplicates, and recovers records through injected CAS', async () => {
  const cas = new MemoryMeshCAS();
  const engine = await new SovereignMeshEngine({ cas }).ready();
  const first = await engine.dispatchAutonomousPayload({
    waveId: 'wave-1', peerId: 'test-peer', action: 'test', payload: { b: 2, a: 1 }
  });
  const duplicate = await engine.dispatchAutonomousPayload({
    waveId: 'wave-1', peerId: 'test-peer', action: 'should-not-replace'
  });
  assert.equal(duplicate.seq, first.seq);
  assert.equal(engine.size, 1);

  const recovered = await new SovereignMeshEngine({ cas }).ready();
  assert.equal(recovered.size, 1);
  assert.equal(recovered.get('wave-1').checksum, first.checksum);
  const second = await recovered.dispatchAutonomousPayload({
    waveId: 'wave-2', peerId: 'test-peer', action: 'test'
  });
  assert.equal(second.seq, first.seq + 1);
});

test('peer-only mesh rejects corrupt record manifests during recovery', async () => {
  const cas = new MemoryMeshCAS();
  const engine = await new SovereignMeshEngine({ cas }).ready();
  await engine.dispatchAutonomousPayload({ waveId: 'wave-tamper', peerId: 'test-peer', action: 'test' });
  const key = engine.key('wave-tamper');
  const ref = await cas.readRef('waves', key);
  ref.value.waveId = 'wave-tampered';
  cas.refs.set('waves/' + key, { hash: ref.hash, value: ref.value });
  await assert.rejects(new SovereignMeshEngine({ cas }).ready(), /integrity or reference-key verification failed/);
});

test('mesh engine has no implicit local persistence fallback', () => {
  assert.throws(() => new SovereignMeshEngine(), /peer-backed CAS; local fallback is forbidden/);
  assert.throws(() => new SovereignMeshEngine('/tmp/legacy-path'), /peer-backed CAS; local fallback is forbidden/);
});
