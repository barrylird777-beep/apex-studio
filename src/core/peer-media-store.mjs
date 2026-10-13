import { createHash } from 'node:crypto';

export const APEX_MEDIA_APPS = Object.freeze([
  'PlanetApeX', 'XShield', 'KernelVision', 'Kernelodies', 'KashKorner', 'KoinKob'
]);
const APP_SET = new Set(APEX_MEDIA_APPS);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const clone = value => value == null ? value : structuredClone(value);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function assertApp(input) {
  const app = String(input || '');
  if (!APP_SET.has(app)) throw new TypeError('Unknown canonical Apex app namespace');
  return app;
}
function assertKey(input, label) {
  const value = String(input || '');
  if (!ID.test(value) || value.includes('..')) throw new TypeError('Invalid ' + label);
  return value;
}

/**
 * Peer-backed media persistence adapter.
 *
 * Media bytes are stored using the per-app PeerContentAddressedStore blob API.
 * Mutable project manifests require an atomic compare-and-swap reference
 * backend: immutable blobs alone cannot safely define the current project
 * state. That backend is injected and must never silently fall back to disk.
 */
export function createPeerMediaStore({ peerStores, maxManifestRetries = 8 } = {}) {
  if (!peerStores || typeof peerStores !== 'object') throw new TypeError('per-app peerStores are required');
  if (!Number.isSafeInteger(maxManifestRetries) || maxManifestRetries < 1 || maxManifestRetries > 32) {
    throw new TypeError('maxManifestRetries must be between 1 and 32');
  }
  for (const app of APEX_MEDIA_APPS) {
    const store = peerStores[app];
    if (!store || typeof store.putBlob !== 'function' || typeof store.getBlob !== 'function' ||
        typeof store.readRef !== 'function' || typeof store.writeRef !== 'function') {
      throw new TypeError('missing peer blob/reference store for canonical app ' + app);
    }
    if (store.namespace !== app) throw new TypeError('peer blob store namespace mismatch for ' + app);
  }

  async function readManifest(app, projectId) {
    const result = await peerStores[app].readRef('project-' + projectId);
    if (result == null) return {
      manifest: { version: 1, app, projectId, assets: [], updatedAt: 0 },
      hash: null
    };
    const manifest = result.value ?? result.record ?? result;
    if (!manifest || manifest.version !== 1 || manifest.app !== app ||
        manifest.projectId !== projectId || !Array.isArray(manifest.assets)) {
      throw new Error('stored project manifest failed schema or namespace validation');
    }
    return { manifest: clone(manifest), hash: result.hash ?? result.etag ?? null };
  }

  async function updateManifest(app, projectId, mutate) {
    for (let attempt = 0; attempt < maxManifestRetries; attempt++) {
      const current = await readManifest(app, projectId);
      const next = mutate(clone(current.manifest));
      next.updatedAt = Date.now();
      try {
        const saved = await peerStores[app].writeRef('project-' + projectId, next, { expectedHash: current.hash });
        return { manifest: next, refHash: saved?.hash ?? saved?.etag ?? null };
      } catch (error) {
        if (error?.code !== 'CAS_MISMATCH' && error?.code !== 'CAS_CONFLICT' && error?.code !== 'CONFLICT' && error?.status !== 409) throw error;
      }
    }
    throw Object.assign(new Error('project manifest changed too often to commit safely'), { code: 'MANIFEST_CONTENTION' });
  }

  return Object.freeze({
    apps: APEX_MEDIA_APPS,
    async saveAsset(appInput, projectInput, assetInput, input, { contentType = 'application/octet-stream', metadata = {} } = {}) {
      const app = assertApp(appInput);
      const projectId = assertKey(projectInput, 'project ID');
      const assetId = assertKey(assetInput, 'asset ID');
      const bytes = Buffer.isBuffer(input) ? Buffer.from(input) : Buffer.from(input ?? []);
      if (!bytes.length) throw new TypeError('peer media asset cannot be empty');

      const digest = sha256(bytes);
      const receipt = await peerStores[app].putBlob(bytes);
      if (!receipt?.hash || !/^[a-f0-9]{64}$/.test(receipt.hash) ||
          receipt.contentSha256 !== digest || receipt.totalBytes !== bytes.length ||
          !Array.isArray(receipt.replicas) || receipt.replicas.length < 1) {
        throw new Error('peer blob store returned an invalid integrity or durability receipt');
      }
      const record = {
        id: assetId, app, projectId, objectHash: receipt.hash, sha256: digest,
        bytes: bytes.length, contentType: String(contentType || 'application/octet-stream'),
        metadata: clone(metadata), replicas: clone(receipt.replicas), updatedAt: Date.now()
      };
      const updated = await updateManifest(app, projectId, manifest => {
        manifest.assets = manifest.assets.filter(asset => asset.id !== assetId);
        manifest.assets.push(record);
        return manifest;
      });
      return { ...record, refHash: updated.refHash };
    },
    async getAsset(appInput, projectInput, assetInput) {
      const app = assertApp(appInput);
      const projectId = assertKey(projectInput, 'project ID');
      const assetId = assertKey(assetInput, 'asset ID');
      const { manifest } = await readManifest(app, projectId);
      const record = manifest.assets.find(asset => asset.id === assetId);
      if (!record) return null;
      if (record.app !== app || record.projectId !== projectId ||
          !/^[a-f0-9]{64}$/.test(record.objectHash || '') ||
          !/^[a-f0-9]{64}$/.test(record.sha256 || '') ||
          !Number.isSafeInteger(record.bytes) || record.bytes < 1) {
        throw new Error('asset reference failed integrity or namespace validation');
      }
      const bytes = await peerStores[app].getBlob(record.objectHash);
      if (bytes.length !== record.bytes || sha256(bytes) !== record.sha256) {
        throw new Error('retrieved peer media failed SHA-256 or byte-length verification');
      }
      return { record: clone(record), bytes };
    },
    async getProject(appInput, projectInput) {
      const app = assertApp(appInput);
      const projectId = assertKey(projectInput, 'project ID');
      const { manifest, hash } = await readManifest(app, projectId);
      return { manifest, hash };
    }
  });
}
