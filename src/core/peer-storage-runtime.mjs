const CANONICAL_APPS = new Set([
  'PlanetApeX', 'XShield', 'KernelVision', 'Kernelodies', 'KashKorner', 'KoinKob'
]);

function parseNamespaceAcl(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return validateAcl(value);
  }
  const source = String(value || '').trim();
  if (!source) throw new Error('peer namespace ACL is empty; access defaults to deny');
  const acl = Object.create(null);
  for (const entry of source.split(';')) {
    const split = entry.indexOf('=');
    if (split < 1) throw new Error('peer namespace ACL must use AppName=peer-a,peer-b;AppName2=peer-c syntax');
    const namespace = entry.slice(0, split).trim();
    const peers = entry.slice(split + 1).split(',').map(peer => peer.trim()).filter(Boolean);
    if (Object.hasOwn(acl, namespace)) throw new Error('duplicate app namespace in peer ACL');
    acl[namespace] = peers;
  }
  return validateAcl(acl);
}

function validateAcl(value) {
  const acl = Object.create(null);
  for (const [namespace, peers] of Object.entries(value)) {
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
 * Opt-in inbound peer object capacity.
 * Persistence is injected as a peer-owned binary backend; this runtime never
 * creates a local filesystem store or silently selects another persistence path.
 */
export async function initializePeerObjectStorage({
  enabled = String(process.env.APEX_PEER_STORAGE_ENABLED || '').toLowerCase() === 'true',
  store,
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
  if (!store || typeof store.putBytes !== 'function' || typeof store.getBytes !== 'function') {
    throw new Error('peer object storage requires an injected peer-owned binary backend; local filesystem fallback is forbidden');
  }
  const acl = parseNamespaceAcl(namespaceAcl);
  const { createPeerObjectStorageHandler } = await import('./peer-content-addressed-store.mjs');
  const handle = createPeerObjectStorageHandler({
    store,
    peerId,
    authorizeNamespace: ({ remotePeerId, namespace }) =>
      Boolean(remotePeerId && Array.isArray(acl[namespace]) && acl[namespace].includes(remotePeerId))
  });
  return Object.freeze({ enabled: true, handle });
}
