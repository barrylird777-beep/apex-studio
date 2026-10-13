import test from 'node:test';
import assert from 'node:assert/strict';
import { isSovereignRuntimeReady, verifyRemoteWalProbe } from '../src/core/runtime-readiness.mjs';

const hash = 'a'.repeat(64);
const instanceId = 'supervisor-generation-1';

test('sovereign readiness requires every runtime gate and a live lease', () => {
  const identity = {
    status: 'online',
    instanceId,
    leaseExpiresAt: 5000,
    lastSeenAt: new Date(3000).toISOString(),
    readiness: {
      storageReady: true,
      peerReady: true,
      remoteWalVerified: true,
      remoteWalHash: hash,
      dispatchReady: true
    }
  };
  assert.equal(isSovereignRuntimeReady(identity, 4000, instanceId), true);
  assert.equal(isSovereignRuntimeReady({ ...identity, lastSeenAt: new Date(1000).toISOString() }, 20000, instanceId), false);
  assert.equal(isSovereignRuntimeReady({ ...identity, instanceId: 'old-generation' }, 4000, instanceId), false);
  assert.equal(isSovereignRuntimeReady(identity, 4000), false);
  assert.equal(isSovereignRuntimeReady(identity, 5000, instanceId), false);
  assert.equal(isSovereignRuntimeReady({ ...identity, status: 'starting' }, 4000, instanceId), false);
  assert.equal(isSovereignRuntimeReady({ ...identity, readiness: { ...identity.readiness, peerReady: false } }, 4000, instanceId), false);
  assert.equal(isSovereignRuntimeReady({ ...identity, readiness: { ...identity.readiness, remoteWalVerified: false } }, 4000, instanceId), false);
  assert.equal(isSovereignRuntimeReady({ ...identity, readiness: { ...identity.readiness, remoteWalHash: 'bad' } }, 4000, instanceId), false);
});

test('remote WAL probe must appear in a validly shaped snapshot at or beyond its sequence', () => {
  const record = { seq: 7, hash };
  assert.equal(verifyRemoteWalProbe(record, { sequence: 7, ring: [record] }), true);
  assert.equal(verifyRemoteWalProbe(record, { sequence: 8, ring: [record] }), true);
  assert.equal(verifyRemoteWalProbe(record, { sequence: 6, ring: [record] }), false);
  assert.equal(verifyRemoteWalProbe(record, { sequence: 7, ring: [{ seq: 7, hash: 'b'.repeat(64) }] }), false);
  assert.equal(verifyRemoteWalProbe({ seq: 0, hash }, { sequence: 7, ring: [record] }), false);
});
