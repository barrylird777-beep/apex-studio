import { createHash } from 'node:crypto';

const CID = /^[a-f0-9]{64}$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/**
 * Pulls chunks from authenticated availability advertisements, scheduling the
 * rarest chunks first. Advertisement and replica-receipt verification remain
 * injected trust-boundary functions; missing verifiers fail closed.
 */
export async function fetchChunksRarestFirst({
  chunks, advertisements, namespace, trustedPeerIds,
  verifyAdvertisement, fetchChunk, verifyReplicaReceipt,
  concurrency = 4, now = Date.now(), maxAdvertisementTtlMs = 60_000,
  maxTotalBytes = 2 * 1024 * 1024 * 1024
} = {}) {
  if (!Array.isArray(chunks) || !Array.isArray(advertisements) || !namespace ||
      typeof verifyAdvertisement !== 'function' || typeof fetchChunk !== 'function' ||
      typeof verifyReplicaReceipt !== 'function') {
    throw new TypeError('chunks, namespace, trusted verifiers, and peer fetcher are required');
  }
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 32 ||
      !Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 1) {
    throw new TypeError('invalid bounded fetch configuration');
  }
  const peerAllowlist = new Set([...trustedPeerIds || []].map(String));
  const expected = new Map();
  let totalBytes = 0;
  for (const chunk of chunks) {
    if (!chunk || !CID.test(String(chunk.hash)) || !Number.isSafeInteger(chunk.bytes) || chunk.bytes < 0) {
      throw new TypeError('invalid chunk descriptor');
    }
    if (expected.has(chunk.hash)) throw new TypeError('duplicate chunk CID in request');
    totalBytes += chunk.bytes;
    if (totalBytes > maxTotalBytes) throw new RangeError('asset exceeds configured in-memory assembly bound');
    expected.set(chunk.hash, { hash: chunk.hash, bytes: chunk.bytes });
  }
  const peersByCid = new Map([...expected.keys()].map(cid => [cid, []]));
  for (const ad of advertisements) {
    if (!ad || ad.namespace !== namespace || !peerAllowlist.has(String(ad.peerId)) ||
        !Number.isFinite(ad.expiresAt) || ad.expiresAt <= now ||
        ad.expiresAt > now + maxAdvertisementTtlMs) continue;
    if (await verifyAdvertisement(ad) !== true) continue;
    const advertised = new Set(Array.isArray(ad.cids) ? ad.cids.filter(cid => CID.test(String(cid))) : []);
    for (const cid of advertised) if (peersByCid.has(cid)) peersByCid.get(cid).push(String(ad.peerId));
  }
  const plan = [...expected.values()].map(chunk => ({
    ...chunk, peers: [...new Set(peersByCid.get(chunk.hash))].sort()
  })).sort((a, b) => a.peers.length - b.peers.length || a.hash.localeCompare(b.hash));
  const results = new Map();
  const failures = [];
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= plan.length) return;
      const chunk = plan[index];
      let success = false;
      for (const peerId of chunk.peers) {
        try {
          const response = await fetchChunk(peerId, chunk.hash, { namespace });
          const bytes = Buffer.isBuffer(response) ? response : Buffer.from(response?.bytes || []);
          if (response?.namespace && response.namespace !== namespace) throw new Error('cross-namespace chunk response');
          if (bytes.length !== chunk.bytes || digest(bytes) !== chunk.hash) throw new Error('chunk CID or length verification failed');
          if (await verifyReplicaReceipt({ peerId, namespace, hash: chunk.hash, bytes, response }) !== true) {
            throw new Error('replica receipt verification failed');
          }
          results.set(chunk.hash, bytes);
          success = true;
          break;
        } catch (error) {
          failures.push({ hash: chunk.hash, peerId, error: String(error?.message || error) });
        }
      }
      if (!success) {
        const error = new Error('no authorized peer supplied a verified chunk');
        error.code = 'OBJECT_UNAVAILABLE';
        error.hash = chunk.hash;
        error.failures = failures.filter(item => item.hash === chunk.hash);
        throw error;
      }
    }
  }
  // A single worker failure rejects the operation; no partial asset is returned.
  await Promise.all(Array.from({ length: Math.min(concurrency, plan.length || 1) }, worker));
  return {
    chunks: results,
    order: plan.map(chunk => chunk.hash),
    rarity: Object.fromEntries(plan.map(chunk => [chunk.hash, chunk.peers.length])),
    bytes: totalBytes,
    failures
  };
}
