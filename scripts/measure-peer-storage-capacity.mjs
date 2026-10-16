import { measurePeerStorageCapacity } from '../src/core/peer-storage-capacity.mjs';

const peerId = process.env.APEX_PEER_ID;
const failureDomain = process.env.APEX_PEER_FAILURE_DOMAIN;
const root = process.env.APEX_PEER_OWNED_STORAGE_ROOT;
const reservedBytes = process.env.APEX_PEER_STORAGE_RESERVED_BYTES === undefined
  ? 0
  : Number(process.env.APEX_PEER_STORAGE_RESERVED_BYTES);

try {
  const report = await measurePeerStorageCapacity({ peerId, failureDomain, root, reservedBytes });
  // Never emit the host filesystem path into an inventory report.
  const { root: _root, ...publicReport } = report;
  process.stdout.write(JSON.stringify(publicReport, null, 2) + '\n');
  process.exitCode = report.usableBytes > 0 ? 0 : 2;
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
  process.exitCode = 1;
}
