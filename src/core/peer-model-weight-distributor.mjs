import { createHash } from 'node:crypto';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const validHash = value => /^[a-f0-9]{64}$/.test(String(value || ''));
const validId = value => typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(value);

/** Store model bytes as verified, encrypted peer-CAS chunks; never use hosted volumes. */
export async function publishPeerModelWeights(store, input, { modelId, revision, maxBytes = 8 * 1024 ** 3 } = {}) {
  if (!store || typeof store.putBlob !== 'function' || typeof store.getBlob !== 'function') {
    throw new TypeError('an authorized peer content-addressed store is required');
  }
  if (!validId(modelId) || !validId(revision)) throw new TypeError('valid modelId and revision are required');
  const bytes = Buffer.from(input || []);
  if (!bytes.length || bytes.length > maxBytes) throw new RangeError('model weight size is empty or exceeds the configured limit');
  const contentSha256 = digest(bytes);
  const stored = await store.putBlob(bytes);
  if (!stored || stored.namespace !== store.namespace || !validHash(stored.hash) ||
      stored.contentSha256 !== contentSha256 || stored.totalBytes !== bytes.length ||
      !Number.isSafeInteger(stored.chunkCount) || stored.chunkCount < 1) {
    throw new Error('peer CAS did not return a matching verified model-weight manifest receipt');
  }
  return Object.freeze({
    kind: 'apex.model-weights.v1',
    namespace: store.namespace,
    modelId,
    revision,
    contentSha256,
    totalBytes: bytes.length,
    blobManifestHash: stored.hash,
    chunkCount: stored.chunkCount
  });
}

/** GPU workers call this with their own peer store and an explicit authorization policy. */
export async function fetchPeerModelWeights(store, manifest, { authorizeModel, maxBytes = 8 * 1024 ** 3 } = {}) {
  if (!store || typeof store.getBlob !== 'function') throw new TypeError('an authorized peer content-addressed store is required');
  if (typeof authorizeModel !== 'function') throw new TypeError('an explicit model authorization policy is required');
  if (!manifest || manifest.kind !== 'apex.model-weights.v1' || manifest.namespace !== store.namespace ||
      !validId(manifest.modelId) || !validId(manifest.revision) || !validHash(manifest.contentSha256) ||
      !validHash(manifest.blobManifestHash) || !Number.isSafeInteger(manifest.totalBytes) ||
      manifest.totalBytes < 1 || manifest.totalBytes > maxBytes ||
      !Number.isSafeInteger(manifest.chunkCount) || manifest.chunkCount < 1) {
    throw new Error('invalid, oversized, or cross-namespace model-weight manifest');
  }
  if (await authorizeModel({ namespace: manifest.namespace, modelId: manifest.modelId, revision: manifest.revision }) !== true) {
    throw new Error('model weight access denied by worker authorization policy');
  }
  const bytes = Buffer.from(await store.getBlob(manifest.blobManifestHash));
  if (bytes.length !== manifest.totalBytes || digest(bytes) !== manifest.contentSha256) {
    throw new Error('reconstructed model weights failed byte-length or SHA-256 verification');
  }
  return bytes;
}
