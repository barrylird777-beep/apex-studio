import path from 'node:path';
import { ContentAddressedStore } from './content-addressed-store.mjs';
import { createPeerObjectStorageHandler } from './peer-content-addressed-store.mjs';

const CANONICAL_APPS = new Set([
  'PlanetApeX', 'XShield', 'KernelVision', 'Kernelodies', 'KashKorner', 'KoinKob'
]);

function parseNamespaceAcl(value) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('peer namespace ACL must be a JSON object keyed by canonical app');
  }
  const acl = Object.create(null);
  for (const [namespace, peers] of Object.entries(parsed)) {
    if (!CANONICAL_APPS.has(namespace)) throw new Error('peer namespace ACL contains a non-canonical app');
    if (!Array.isArray(peers) || peers.length === 0 ||
        peers.some(peer => typeof peer !== 'string' || !peer.trim())) {
      throw new Error('each configured peer namespace ACL must contain explicit peer IDs');
    }
    acl[namespace] = [...new Set(peers.map(peer => peer.trim()))];
  }
  if (Object.keys(acl).length === 0) throw new Error('peer namespace ACL is empty; access defaults to deny');
  return acl;
}

/**
 * Optional server-side peer object capacity. Disabled unless explicitly enabled.
 * It requires a separately configured absolute storage root and app-scoped ACL;
 * it never falls back to the general runtime store or creates an implicit ACL.
 */
export async function initializePeerObjectStorage({
  enabled = String(process.env.APEX_PEER_STORAGE_ENABLED || '').toLowerCase() === 'true',
  root = process.env.APEX_PEER_OBJECT_STORE_ROOT || '',
  namespaceAcl = process.env.APEX_PEER_NAMESPACE_ACL || '',
  peerId = () => ''
} = {}) {
  if (!enabled) {
    return Object.freeze({
      enabled: false,
      store: null,
      handle: async () => { throw new Error('peer object storage is disabled'); }
    });
  }

  const configuredRoot = String(root || '').trim();
  if (!configuredRoot || !path.isAbsolute(configuredRoot) || path.resolve(configuredRoot) === path.parse(path.resolve(configuredRoot)).root) {
    throw new Error('peer object storage requires an explicit absolute non-root APEX_PEER_OBJECT_STORE_ROOT');
  }
  const acl = parseNamespaceAcl(namespaceAcl);
  const store = new ContentAddressedStore({ root: path.resolve(configuredRoot) });
  await store.init();
  const handle = createPeerObjectStorageHandler({
    store,
    peerId,
    authorizeNamespace: ({ remotePeerId, namespace }) =>
      Boolean(remotePeerId && Array.isArray(acl[namespace]) && acl[namespace].includes(remotePeerId))
  });
  return Object.freeze({ enabled: true, store, handle });
}
