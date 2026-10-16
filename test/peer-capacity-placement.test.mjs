import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverCapacityQualifiedPeers } from '../src/core/peer-capacity-placement.mjs';

const now = 1_800_000_000_000;
function report(peerId, failureDomain, overrides = {}) {
  return {
    schemaVersion: 1, peerId, failureDomain, measuredAt: now - 1000, expiresAt: now + 59000,
    totalBytes: 10_000, availableBytes: 8_000, reservedBytes: 1000, usableBytes: 7000,
    capacitySource: 'filesystem-statfs', attestationStatus: 'MEASURED_UNAUTHENTICATED',
    ...overrides
  };
}

function fixture(reports) {
  return {
    request: async (peerId, envelope) => {
      assert.equal(envelope.operation, 'storage.health');
      return { accepted: true, peerId, namespace: envelope.namespace, durable: true, ownership: 'peer-owned', recoveryVerified: true, restartRecoveryVerified: true, atomicReferencesVerified: true, receipt: { verified: true }, receiptId: 'durability-' + peerId, capacityReport: reports[peerId] };
    }
  };
}

test('capacity placement accepts only fresh reports bound to authenticated identity and trusted domains', async () => {
  const result = await discoverCapacityQualifiedPeers({
    peers: ['peer-a', 'peer-b'], transport: fixture({
      'peer-a': report('peer-a', 'rack-a'),
      'peer-b': report('peer-b', 'rack-b')
    }), namespace: 'KernelVision', trustedFailureDomains: { 'peer-a': 'rack-a', 'peer-b': 'rack-b' },
    now, minUsableBytes: 5000
  });
  assert.deepEqual(result.qualified.map(peer => peer.peerId), ['peer-a', 'peer-b']);
  assert.deepEqual(result.rejected, []);
});

test('capacity placement rejects forged identity, self-claimed failure domains, stale reports and low capacity', async () => {
  const result = await discoverCapacityQualifiedPeers({
    peers: ['wrong-id', 'untrusted-domain', 'stale', 'long-lived', 'low'],
    transport: fixture({
      'wrong-id': report('other-peer', 'rack-a'),
      'untrusted-domain': report('untrusted-domain', 'claimed-rack'),
      stale: report('stale', 'rack-b', { expiresAt: now - 1 }),
      'long-lived': report('long-lived', 'rack-d', { expiresAt: now + 5 * 60_000 + 1 }),
      low: report('low', 'rack-c', { availableBytes: 2000, reservedBytes: 1999, usableBytes: 1 })
    }),
    namespace: 'KernelVision',
    trustedFailureDomains: { 'wrong-id': 'rack-a', 'untrusted-domain': 'rack-a', stale: 'rack-b', 'long-lived': 'rack-d', low: 'rack-c' },
    now, minUsableBytes: 5000
  });
  assert.deepEqual(result.qualified, []);
  assert.equal(result.rejected.length, 5);
});

test('capacity placement rejects missing reports and authenticated transport identity mismatch', async () => {
  const transport = {
    request: async peerId => peerId === 'peer-a'
      ? { accepted: true, peerId: 'other-peer', namespace: 'KernelVision', durable: true, ownership: 'peer-owned', recoveryVerified: true, restartRecoveryVerified: true, atomicReferencesVerified: true, receipt: { verified: true }, receiptId: 'durability-peer-a', capacityReport: report('peer-a', 'rack-a') }
      : { accepted: true, peerId, namespace: 'KernelVision', durable: true, ownership: 'peer-owned', recoveryVerified: true, restartRecoveryVerified: true, atomicReferencesVerified: true, receipt: { verified: true }, receiptId: 'durability-peer-b' }
  };
  const result = await discoverCapacityQualifiedPeers({
    peers: ['peer-a', 'peer-b'], transport, namespace: 'KernelVision',
    trustedFailureDomains: { 'peer-a': 'rack-a', 'peer-b': 'rack-b' }, now
  });
  assert.deepEqual(result.qualified, []);
  assert.equal(result.rejected.length, 2);
});
