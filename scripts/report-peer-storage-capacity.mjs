import { measurePeerStorageCapacity } from '../src/core/peer-storage-capacity.mjs';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(name + ' is required; capacity reporting will not guess a peer identity, failure domain, or storage root');
  return value;
}

function nonNegativeInteger(name, fallback) {
  const raw = String(process.env[name] ?? fallback).trim();
  if (!/^\d+$/.test(raw)) throw new Error(name + ' must be a non-negative integer');
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(name + ' exceeds the safe integer range');
  return value;
}

try {
  const report = await measurePeerStorageCapacity({
    peerId: required('APEX_SOVEREIGN_PEER_ID'),
    failureDomain: required('APEX_PEER_FAILURE_DOMAIN'),
    root: required('APEX_PEER_OWNED_STORAGE_ROOT'),
    reservedBytes: nonNegativeInteger('APEX_PEER_STORAGE_RESERVED_BYTES', '0'),
    ttlMs: nonNegativeInteger('APEX_PEER_STORAGE_CAPACITY_TTL_MS', '60000')
  });
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
  process.exitCode = 1;
}
