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

function parseReferenceLeaders(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return validateReferenceLeaders(value);
  const source = String(value || '').trim();
  if (!source) return Object.create(null);
  const leaders = Object.create(null);
  for (const entry of source.split(';')) {
    const split = entry.indexOf('=');
    if (split < 1) throw new Error('peer reference leaders must use AppName=peer-id;AppName2=peer-id syntax');
    const namespace = entry.slice(0, split).trim();
    const peerId = entry.slice(split + 1).trim();
    if (Object.hasOwn(leaders, namespace)) throw new Error('duplicate app namespace in peer reference leaders');
    leaders[namespace] = peerId;
  }
  return validateReferenceLeaders(leaders);
}

function validateReferenceLeaders(value) {
  const leaders = Object.create(null);
  for (const [namespace, peerIdRaw] of Object.entries(value)) {
    const peerId = String(peerIdRaw || '').trim();
    if (!CANONICAL_APPS.has(namespace)) throw new Error('peer reference leader map contains a non-canonical app');
    if (!peerId) throw new Error('each configured peer reference leader must have an explicit peer ID');
    leaders[namespace] = peerId;
  }
  return leaders;
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
  referenceLeaderByNamespace = process.env.APEX_PEER_REFERENCE_LEADERS || '',
  peerId = () => ''
} = {}) {
  if (!enabled) {
    return Object.freeze({
      enabled: false,
      store: null,
      handle: async () => { throw new Error('peer object storage is disabled'); }
    });
  }
  if (!store || typeof store.putBytes !== 'function' || typeof store.getBytes !== 'function' ||
      typeof store.readRef !== 'function' || typeof store.writeRef !== 'function') {
    throw new Error('peer object storage requires an injected peer-owned binary backend with atomic refs; local filesystem fallback is forbidden');
  }
  const acl = parseNamespaceAcl(namespaceAcl);
  const leaders = parseReferenceLeaders(referenceLeaderByNamespace);
  const { createPeerObjectStorageHandler } = await import('./peer-content-addressed-store.mjs');
  const handle = createPeerObjectStorageHandler({
    store,
    peerId,
    referenceLeaderByNamespace: leaders,
    authorizeNamespace: ({ remotePeerId, namespace }) =>
      Boolean(remotePeerId && Array.isArray(acl[namespace]) && acl[namespace].includes(remotePeerId))
  });
  return Object.freeze({ enabled: true, store, handle });
}
