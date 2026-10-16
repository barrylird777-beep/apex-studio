import { measurePeerStorageCapacity, validatePeerStorageCapacity } from '../src/core/peer-storage-capacity.mjs';

try {
  const report = await measurePeerStorageCapacity({
    peerId: process.env.APEX_PEER_ID,
    failureDomain: process.env.APEX_PEER_FAILURE_DOMAIN
  });
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (!validatePeerStorageCapacity(report)) process.exitCode = 2;
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
  process.exitCode = 1;
}
