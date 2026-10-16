import { validateAuthenticatedPeerStorageCapacity } from './peer-storage-capacity.mjs';

/**
 * Probe peers over the authenticated transport and return only peers whose
 * fresh capacity report is bound to the authenticated peer ID and trusted
 * operator failure-domain registry. Reports alone never establish durability.
 */
export async function discoverCapacityQualifiedPeers({
  peers,
  transport,
  namespace,
  trustedFailureDomains,
  minUsableBytes = 1,
  now = Date.now(),
  maxAgeMs = 60_000
} = {}) {
  if (!Array.isArray(peers) || peers.length === 0) throw new TypeError('explicit peer allowlist is required');
  if (!transport || typeof transport.request !== 'function') throw new TypeError('authenticated peer transport is required');
  if (typeof namespace !== 'string' || !/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(namespace)) throw new TypeError('valid app namespace is required');
  if (!Number.isSafeInteger(minUsableBytes) || minUsableBytes < 1) throw new TypeError('minUsableBytes must be a positive safe integer');

  const qualified = [];
  const rejected = [];
  for (const peerId of [...new Set(peers.map(String))]) {
    try {
      const response = await transport.request(peerId, {
        protocol: 'apex.cas.v1',
        operation: 'storage.health',
        namespace
      });
      if (!response || response.accepted !== true || response.peerId !== peerId || response.namespace !== namespace) {
        throw new Error('authenticated peer identity or namespace mismatch');
      }
      const report = response.capacityReport;
      if (!validateAuthenticatedPeerStorageCapacity(report, {
        authenticatedPeerId: response.peerId,
        trustedFailureDomains,
        now,
        maxAgeMs
      })) throw new Error('capacity report is stale, unauthenticated, or has an untrusted failure domain');
      if (report.usableBytes < minUsableBytes) throw new Error('peer has insufficient usable capacity');
      qualified.push({ peerId, failureDomain: report.failureDomain, usableBytes: report.usableBytes, expiresAt: report.expiresAt });
    } catch (error) {
      rejected.push({ peerId, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { qualified, rejected };
}
