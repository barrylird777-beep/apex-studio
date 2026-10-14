import { createHash } from 'node:crypto';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const validId = value => typeof value === 'string' && value.length <= 256 &&
  value.split('/').every(part => /^[A-Za-z0-9._-]{1,128}$/.test(part));
const validHash = value => /^[a-f0-9]{64}$/.test(String(value || ''));
const MAX_FILE_BYTES = 32 * 1024 ** 3;
const MAX_BUNDLE_BYTES = 64 * 1024 ** 3;
const MAX_FILES = 512;

function safePath(value) {
  return typeof value === 'string' && value.length <= 512 &&
    !value.startsWith('/') && !value.includes('\\') && !value.includes('\0') &&
    value.split('/').every(part => part && part !== '.' && part !== '..');
}

function refKey(modelId, revision) {
  if (!validId(modelId) || !validId(revision)) throw new TypeError('invalid model ID or revision');
  return `model-bundle.v1/${modelId}/${revision}`;
}

/**
 * Publish a complete immutable model bundle into the app-scoped peer CAS.
 * Input files are byte arrays already obtained by an authorized publisher.
 * Peer-CAS blobs and the replicated reference are authoritative; no disk cache.
 */
export async function publishPeerModelBundle(store, inputFiles, {
  modelId, revision, maxBundleBytes = MAX_BUNDLE_BYTES
} = {}) {
  if (!store || store.namespace == null || typeof store.putBlob !== 'function' ||
      typeof store.writeRef !== 'function' || typeof store.readRef !== 'function') {
    throw new TypeError('an initialized per-app PeerContentAddressedStore is required');
  }
  if (!validId(modelId) || !validId(revision)) throw new TypeError('valid modelId and revision are required');
  if (!Array.isArray(inputFiles) || inputFiles.length < 3 || inputFiles.length > MAX_FILES) {
    throw new RangeError('model bundle must contain between 3 and 4096 files');
  }
  const seen = new Set();
  const files = [];
  let totalBytes = 0;
  for (const input of inputFiles) {
    const path = input?.path;
    if (!safePath(path) || seen.has(path)) throw new Error('invalid or duplicate model asset path');
    seen.add(path);
    const bytes = Buffer.from(input.bytes || []);
    if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new RangeError('empty or oversized model asset');
    totalBytes += bytes.length;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > maxBundleBytes) {
      throw new RangeError('model bundle exceeds configured aggregate byte limit');
    }
    files.push({ path, bytes, size: bytes.length, sha256: digest(bytes) });
  }
  if (!seen.has('config.json') ||
      !files.some(file => file.path.endsWith('.safetensors')) ||
      !seen.has('tokenizer.json')) {
    throw new Error('bundle requires config.json, Safetensors weights, and tokenizer.json; SentencePiece-only tokenizer.model bundles are not supported by the in-memory adapter');
  }

  const storedFiles = [];
  for (const file of files) {
    const stored = await store.putBlob(file.bytes);
    if (stored.namespace !== store.namespace || stored.contentSha256 !== file.sha256 ||
        stored.totalBytes !== file.size || !validHash(stored.hash)) {
      throw new Error(`Peer-CAS verification failed for model asset: ${file.path}`);
    }
    storedFiles.push({
      path: file.path, sha256: file.sha256, size: file.size,
      blobManifestHash: stored.hash, chunkCount: stored.chunkCount
    });
  }
  storedFiles.sort((a, b) => a.path.localeCompare(b.path));
  const manifest = Object.freeze({
    kind: 'apex.model-bundle.v1', namespace: store.namespace,
    modelId, revision, totalBytes, files: storedFiles
  });
  const key = refKey(modelId, revision);
  const previous = await store.readRef(key);
  const written = await store.writeRef(key, manifest, { expectedHash: previous?.hash ?? null });
  if (written.hash == null || written.hash.length !== 64) {
    throw new Error('Peer-CAS did not confirm the replicated model-bundle reference');
  }
  return Object.freeze({ ...manifest, manifestHash: written.hash, referenceKey: key });
}

/** Resolve and reconstruct the bundle only from verified, authorized peer-CAS data. */
export async function fetchPeerModelBundle(store, { modelId, revision, authorizeModel,
  maxBundleBytes = MAX_BUNDLE_BYTES } = {}) {
  if (!store || store.namespace == null || typeof store.getBlob !== 'function' ||
      typeof store.readRef !== 'function') {
    throw new TypeError('an initialized per-app PeerContentAddressedStore is required');
  }
  if (typeof authorizeModel !== 'function') throw new TypeError('explicit model authorization is required');
  if (await authorizeModel({ namespace: store.namespace, modelId, revision }) !== true) {
    throw new Error('model bundle access denied');
  }
  const found = await store.readRef(refKey(modelId, revision));
  const manifest = found?.value;
  if (!manifest || manifest.kind !== 'apex.model-bundle.v1' ||
      manifest.namespace !== store.namespace || manifest.modelId !== modelId ||
      manifest.revision !== revision || !Array.isArray(manifest.files) ||
      manifest.files.length < 3 || manifest.files.length > MAX_FILES ||
      !Number.isSafeInteger(manifest.totalBytes) || manifest.totalBytes < 1 ||
      manifest.totalBytes > maxBundleBytes) {
    throw new Error('missing, invalid, oversized, or cross-namespace model bundle');
  }
  const output = new Map();
  let totalBytes = 0;
  for (const file of manifest.files) {
    if (!safePath(file?.path) || output.has(file.path) || !validHash(file.sha256) ||
        !validHash(file.blobManifestHash) || !Number.isSafeInteger(file.size) ||
        file.size < 1 || file.size > MAX_FILE_BYTES) {
      throw new Error('invalid model asset descriptor');
    }
    const bytes = Buffer.from(await store.getBlob(file.blobManifestHash));
    if (bytes.length !== file.size || digest(bytes) !== file.sha256) {
      throw new Error(`model asset failed integrity verification: ${file.path}`);
    }
    totalBytes += bytes.length;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > maxBundleBytes) {
      throw new RangeError('reconstructed model bundle exceeds configured aggregate byte limit');
    }
    output.set(file.path, bytes);
  }
  if (totalBytes !== manifest.totalBytes || !output.has('config.json') ||
      ![...output.keys()].some(path => path.endsWith('.safetensors')) ||
      !output.has('tokenizer.json')) {
    throw new Error('reconstructed model bundle does not match its manifest or lacks supported tokenizer.json');
  }
  return Object.freeze({ manifest, manifestHash: found.hash, files: output });
}
