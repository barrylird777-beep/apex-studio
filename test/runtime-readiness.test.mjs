import test from 'node:test';
import assert from 'node:assert/strict';
import { isSovereignRuntimeReady, verifyRemotePersistenceProbe } from '../src/core/runtime-readiness.mjs';

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
      remotePersistenceVerified: true,
      remotePersistenceHash: hash,
      peerStorageVerified: true,
      dispatchReady: true
    }
  };
  assert.equal(isSovereignRuntimeReady(identity, 4000, instanceId), true);
  assert.equal(isSovereignRuntimeReady(identity, 4000, instanceId, true), false);
  assert.equal(isSovereignRuntimeReady({ ...identity, leaseExpiresAt: 30000, lastSeenAt: new Date(1000).toISOString() }, 20000, instanceId), false);
  assert.equal(isSovereignRuntimeReady({ ...identity, instanceId: 'old-generation' }, 4000, instanceId), false);
  assert.equal(isSovereignRuntimeReady(identity, 4000), false);
  assert.equal(isSovereignRuntimeReady(identity, 5000, instanceId), false);
  assert.equal(isSovereignRuntimeReady({ ...identity, status: 'starting' }, 4000, instanceId), false);
  assert.equal(isSovereignRuntimeReady({ ...identity, readiness: { ...identity.readiness, peerReady: false } }, 4000, instanceId), false);
  assert.equal(isSovereignRuntimeReady({ ...identity, readiness: { ...identity.readiness, remotePersistenceVerified: false } }, 4000, instanceId), false);
  assert.equal(isSovereignRuntimeReady({ ...identity, readiness: { ...identity.readiness, peerStorageVerified: false } }, 4000, instanceId), false);
  assert.equal(isSovereignRuntimeReady({ ...identity, readiness: { ...identity.readiness, remotePersistenceHash: 'bad' } }, 4000, instanceId), false);
});

test('remote CAS probe requires matching readback and a valid content hash', () => {
  const probe = { version: 1, nonce: 'nonce-7', peerId: 'peer-a' };
  const readback = { hash, value: { ...probe } };
  assert.equal(verifyRemotePersistenceProbe(probe, readback), true);
  assert.equal(verifyRemotePersistenceProbe(probe, { ...readback, value: { ...probe, nonce: 'other' } }), false);
  assert.equal(verifyRemotePersistenceProbe(probe, { ...readback, hash: 'bad' }), false);
  assert.equal(verifyRemotePersistenceProbe(probe, null), false);
});
