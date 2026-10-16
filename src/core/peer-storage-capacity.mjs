import { statfs } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_TTL_MS = 60_000;
const MAX_TTL_MS = 5 * 60_000;
const integer = value => Number.isSafeInteger(value) && value >= 0;

/**
 * Measure the filesystem explicitly assigned to one storage peer.
 * This is an operator-side measurement, not by itself an authenticated peer
 * advertisement or a durability receipt. Callers must bind it to an
 * authenticated peer identity and reject stale measurements before placement.
 */
export async function measurePeerStorageCapacity({
  peerId,
  failureDomain,
  root = process.env.APEX_PEER_OWNED_STORAGE_ROOT,
  reservedBytes = Number(process.env.APEX_PEER_STORAGE_RESERVED_BYTES || 0),
  now = Date.now(),
  ttlMs = DEFAULT_TTL_MS
} = {}) {
  if (typeof peerId !== 'string' || !peerId.trim()) throw new Error('explicit peerId is required');
  if (typeof failureDomain !== 'string' || !failureDomain.trim()) throw new Error('explicit failureDomain is required');
  if (typeof root !== 'string' || !root.trim()) throw new Error('APEX_PEER_OWNED_STORAGE_ROOT must explicitly name peer-owned capacity');
  if (!integer(reservedBytes)) throw new Error('reservedBytes must be a non-negative safe integer');
  if (!integer(now)) throw new Error('now must be a non-negative safe integer timestamp');
  if (!integer(ttlMs) || ttlMs < 1 || ttlMs > MAX_TTL_MS) throw new Error('ttlMs must be between 1ms and 5 minutes');

  const resolvedRoot = path.resolve(root);
  const fs = await statfs(resolvedRoot, { bigint: true });
  const blockSize = fs.bsize;
  const totalBytesBig = fs.blocks * blockSize;
  const availableBytesBig = fs.bavail * blockSize;
  const safeNumber = (value, label) => {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(label + ' exceeds safe integer range');
    return Number(value);
  };
  const totalBytes = safeNumber(totalBytesBig, 'totalBytes');
  const availableBytes = safeNumber(availableBytesBig, 'availableBytes');
  const usableBytes = Math.max(0, availableBytes - reservedBytes);

  return Object.freeze({
    schemaVersion: 1,
    peerId: peerId.trim(),
    failureDomain: failureDomain.trim(),
    root: resolvedRoot,
    measuredAt: now,
    expiresAt: now + ttlMs,
    totalBytes,
    availableBytes,
    reservedBytes,
    usableBytes,
    capacitySource: 'filesystem-statfs',
    attestationStatus: 'MEASURED_UNAUTHENTICATED'
  });
}

/** Reject expired, malformed, or empty capacity reports before placement. */
export function validatePeerStorageCapacity(report, {
  now = Date.now(),
  maxAgeMs = DEFAULT_TTL_MS
} = {}) {
  if (!report || report.schemaVersion !== 1 ||
      typeof report.peerId !== 'string' || !report.peerId ||
      typeof report.failureDomain !== 'string' || !report.failureDomain ||
      report.capacitySource !== 'filesystem-statfs' ||
      report.attestationStatus !== 'MEASURED_UNAUTHENTICATED' ||
      !integer(report.measuredAt) || !integer(report.expiresAt) ||
      !integer(report.totalBytes) || !integer(report.availableBytes) ||
      !integer(report.reservedBytes) || !integer(report.usableBytes) ||
      !integer(now) || !integer(maxAgeMs)) return false;
  if (report.expiresAt <= now || report.measuredAt > now ||
      now - report.measuredAt > maxAgeMs) return false;
  if (report.availableBytes > report.totalBytes ||
      report.usableBytes !== Math.max(0, report.availableBytes - report.reservedBytes)) return false;
  return report.usableBytes > 0;
}
