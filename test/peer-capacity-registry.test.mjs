import test from 'node:test';
import assert from 'node:assert/strict';
import { PeerCapacityRegistry } from '../src/core/peer-capacity-registry.mjs';

const hash = 'a'.repeat(64);
const peerId = 'mobile-peer-0001';
const firstSession = 'browser-session-0001';
const nextSession = 'browser-session-0002';
const app = 'PlanetApeX';

function registryWithClock() {
  let now = 1_000_000;
  const registry = new PeerCapacityRegistry({ leaseMs: 5_000, now: () => now });
  return { registry, advance: ms => { now += ms; } };
}

test('broker advertises zero durable capacity and rejects writes without a live advertised peer', () => {
  const { registry } = registryWithClock();
  assert.equal(registry.peerStatus('railway-broker'), null);
  assert.throws(() => registry.beginWrite({
    peerId, sessionId: firstSession, namespace: app, hash, bytes: 123
  }), /no eligible live storage peer/);
  const peer = registry.advertise({
    peerId, sessionId: firstSession, capacityBytes: 0, appIds: [app]
  });
  assert.equal(peer.durableCapacityBytes, 0);
  assert.equal(peer.available, false);
});

test('payload is not durable until hash proof arrives from a new browser session', () => {
  const { registry } = registryWithClock();
  registry.advertise({ peerId, sessionId: firstSession, capacityBytes: 100_000, appIds: [app], storageKind: 'opfs' });
  assert.equal(registry.beginWrite({ peerId, sessionId: firstSession, namespace: app, hash, bytes: 123 }).durable, false);
  assert.equal(registry.acknowledgeWrite({ peerId, sessionId: firstSession, namespace: app, hash, accepted: true }).status, 'volatile');
  assert.throws(() => registry.verifyReadback({
    peerId, sessionId: firstSession, namespace: app, hash, proofHash: 'b'.repeat(64)
  }), /does not match/);

  // A fresh record exercises the complete successful lifecycle.
  const hash2 = 'c'.repeat(64);
  registry.beginWrite({ peerId, sessionId: firstSession, namespace: app, hash: hash2, bytes: 456 });
  registry.verifyReadback({ peerId, sessionId: firstSession, namespace: app, hash: hash2, proofHash: hash2 });
  assert.equal(registry.status(app, hash2).durableReplicaCount, 0);
  assert.throws(() => registry.verifyRecovery({
    peerId, sessionId: firstSession, namespace: app, hash: hash2, proofHash: hash2
  }), /new active browser session/);

  registry.advertise({ peerId, sessionId: nextSession, capacityBytes: 100_000, appIds: [app], storageKind: 'opfs' });
  const recovered = registry.verifyRecovery({
    peerId, sessionId: nextSession, namespace: app, hash: hash2, proofHash: hash2
  });
  assert.equal(recovered.status, 'recovery_verified');
  assert.equal(recovered.durableReplicaCount, 1);
  assert.deepEqual(registry.route(app, hash2), {
    peerId, namespace: app, hash: hash2, state: 'restart_recovery_verified'
  });
});

test('expired leases make payloads unavailable and block new writes', () => {
  const { registry, advance } = registryWithClock();
  registry.advertise({ peerId, sessionId: firstSession, capacityBytes: 100_000, appIds: [app], storageKind: 'indexeddb' });
  const hash2 = 'd'.repeat(64);
  registry.beginWrite({ peerId, sessionId: firstSession, namespace: app, hash: hash2, bytes: 7 });
  registry.verifyReadback({ peerId, sessionId: firstSession, namespace: app, hash: hash2, proofHash: hash2 });
  registry.advertise({ peerId, sessionId: nextSession, capacityBytes: 100_000, appIds: [app] });
  registry.verifyRecovery({ peerId, sessionId: nextSession, namespace: app, hash: hash2, proofHash: hash2 });
  advance(5_001);
  assert.equal(registry.status(app, hash2).status, 'unavailable');
  assert.throws(() => registry.route(app, hash2), /no live recovery-verified storage peer/);
  assert.throws(() => registry.beginWrite({
    peerId, sessionId: nextSession, namespace: app, hash: 'e'.repeat(64), bytes: 9
  }), /no eligible live storage peer/);
});

test('peer namespace allowlist rejects unknown apps', () => {
  const { registry } = registryWithClock();
  assert.throws(() => registry.advertise({
    peerId, sessionId: firstSession, capacityBytes: 100, appIds: ['KoBlocks']
  }), /canonical app names/);
});
