import { randomBytes } from 'node:crypto';
import { PeerContentAddressedStore } from './peer-content-addressed-store.mjs';
import { createLibp2pPeerStorageTransport } from './peer-storage-libp2p-transport.mjs';
import { createPeerModelBridgeServer } from './peer-model-bridge.mjs';

const APPS = new Set(['KernelVision', 'XShield', 'Kernelodies', 'PlanetApeX', 'KashKorner', 'KoinKob']);

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(name + ' is required; Peer-CAS stays disabled');
  return value;
}

async function loadPeerTrustProvider() {
  const specifier = required('APEX_PEER_TRUST_PROVIDER_MODULE');
  let provider;
  try { provider = await import(specifier); }
  catch (cause) {
    throw new Error('configured hardware-root trust provider could not be loaded; peer CAS startup refused', { cause });
  }
  for (const name of ['getPeerAdvertisements', 'getPeerPublicKey', 'verifyHardwareRoot',
    'attestPeerHardwareRoot', 'getHardwareFailureDomain']) {
    if (typeof provider[name] !== 'function') {
      throw new Error('hardware-root provider must export ' + name + '; peer CAS startup refused');
    }
  }
  return Object.freeze({
    getPeerAdvertisements: provider.getPeerAdvertisements,
    getPeerPublicKey: provider.getPeerPublicKey,
    verifyHardwareRoot: provider.verifyHardwareRoot,
    attestPeerHardwareRoot: provider.attestPeerHardwareRoot,
    getHardwareFailureDomain: provider.getHardwareFailureDomain
  });
}

/**
 * Require a fresh, challenge-bound platform attestation for every configured
 * peer before it can count toward a replica or failure-domain quorum.
 */
export async function attestConfiguredPeerRoots({ peers, namespace, provider, now = Date.now } = {}) {
  if (!Array.isArray(peers) || !peers.length || !APPS.has(namespace) ||
      !provider || typeof provider.attestPeerHardwareRoot !== 'function' ||
      typeof provider.verifyHardwareRoot !== 'function' ||
      typeof provider.getHardwareFailureDomain !== 'function') {
    throw new TypeError('peer list, canonical app, and complete hardware-root provider are required');
  }
  const domains = Object.create(null);
  for (const peerId of peers) {
    const issuedAt = now();
    const challenge = randomBytes(32).toString('base64url');
    const evidence = await provider.attestPeerHardwareRoot({ peerId, app: namespace, challenge, issuedAt });
    if (!evidence || evidence.peerId !== peerId || evidence.app !== namespace ||
        evidence.challenge !== challenge || !/^[a-f0-9]{64}$/.test(String(evidence.hardwareRootCid || '')) ||
        !Number.isSafeInteger(evidence.issuedAt) || Math.abs(evidence.issuedAt - issuedAt) > 5000 ||
        !Number.isSafeInteger(evidence.expiresAt) || evidence.expiresAt <= now() ||
        evidence.expiresAt > issuedAt + 60000 ||
        await provider.verifyHardwareRoot(evidence, { peerId, app: namespace, challenge, now: now() }) !== true) {
      throw new Error('peer hardware-root attestation is invalid, stale, or not bound to the live challenge; startup refused');
    }
    const domain = await provider.getHardwareFailureDomain(evidence, { peerId, app: namespace });
    if (typeof domain !== 'string' || !domain.trim() || domain.length > 256) {
      throw new Error('hardware-root provider did not return a verified physical failure-domain identity');
    }
    domains[peerId] = 'hardware-root:' + domain.trim();
  }
  return Object.freeze(domains);
}

async function loadDurabilityReceiptVerifier() {
  const specifier = required('APEX_PEER_RECEIPT_VERIFIER_MODULE');
  let verifierModule;
  try { verifierModule = await import(specifier); }
  catch (cause) {
    throw new Error('configured peer durability receipt verifier could not be loaded; Peer-CAS stays disabled', { cause });
  }
  if (typeof verifierModule.verifyDurabilityReceipt !== 'function') {
    throw new Error('APEX_PEER_RECEIPT_VERIFIER_MODULE must export verifyDurabilityReceipt(receipt, claims); Peer-CAS stays disabled');
  }
  return verifierModule.verifyDurabilityReceipt;
}

function parsePeers(value) {
  const result = Object.create(null);
  for (const entry of value.split(';')) {
    const split = entry.indexOf('=');
    if (split < 1) throw new Error('APEX_PEER_CAS_PEERS must use peerId=/ip4/.../tcp/.../p2p/peerId entries separated by semicolons');
    const id = entry.slice(0, split).trim();
    const address = entry.slice(split + 1).trim();
    const match = address.match(/\/p2p\/([^/]+)$/);
    if (!id || !match || match[1] !== id || result[id]) throw new Error('invalid or duplicate Peer-CAS peer address');
    result[id] = address;
  }
  if (!Object.keys(result).length) throw new Error('at least one explicit Peer-CAS storage peer is required');
  return result;
}


function collectReferencedCids(value, output = new Set(), key = '') {
  if (Array.isArray(value)) {
    for (const item of value) collectReferencedCids(item, output, key);
    return output;
  }
  if (!value || typeof value !== 'object') {
    if (['cid', 'tensorCid', 'resultCid', 'objectCid', 'assetCid', 'chunkCid'].includes(key) ||
        (key === 'hash' && Array.isArray(value?.chunks))) {
      if (/^[a-f0-9]{64}$/.test(String(value || ''))) output.add(String(value));
    }
    return output;
  }
  for (const [childKey, child] of Object.entries(value)) {
    if (['cid', 'tensorCid', 'resultCid', 'objectCid', 'assetCid', 'chunkCid'].includes(childKey) &&
        /^[a-f0-9]{64}$/.test(String(child || ''))) output.add(String(child));
    if (childKey === 'chunks' && Array.isArray(child)) {
      for (const chunk of child) {
        if (/^[a-f0-9]{64}$/.test(String(chunk?.hash || ''))) output.add(String(chunk.hash));
      }
    }
    collectReferencedCids(child, output, childKey);
  }
  return output;
}

/** Create the app-scoped peer CAS used by the mesh engine; no model bridge. */
export async function createPeerMeshCasRuntime({ peerNode, namespace: namespaceOverride, encryptionKeyBase64: keyOverride } = {}) {
  if (!peerNode || typeof peerNode.dialProtocol !== 'function') throw new TypeError('started sovereign peer node required');
  const namespace = namespaceOverride !== undefined ? namespaceOverride : required('APEX_PEER_CAS_NAMESPACE');
  if (!APPS.has(namespace)) throw new Error('Peer-CAS namespace must name one canonical app');
  const keyEnvName = 'APEX_PEER_CAS_ENCRYPTION_KEY_BASE64_' + namespace.toUpperCase();
  const encodedKey = keyOverride || (namespaceOverride !== undefined ? required(keyEnvName) : required('APEX_PEER_CAS_ENCRYPTION_KEY_BASE64'));
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encodedKey) throw new Error('Peer-CAS encryption key must be canonical base64 for exactly 32 bytes');
  const addressesByPeerId = parsePeers(required('APEX_PEER_CAS_PEERS'));
  const peers = Object.keys(addressesByPeerId);
  const replicaCount = Number(process.env.APEX_PEER_CAS_REPLICAS || 2);
  const minFailureDomains = Number(process.env.APEX_PEER_CAS_FAILURE_DOMAINS || 1);
  if (peers.length < replicaCount) throw new Error('mesh startup refused: configured peer set is below the required replica count');
  const transport = createLibp2pPeerStorageTransport({ node: peerNode, addressesByPeerId });
  const verifyDurabilityReceipt = await loadDurabilityReceiptVerifier();
  const peerTrustProvider = await loadPeerTrustProvider();
  const failureDomainsByPeerId = await attestConfiguredPeerRoots({ peers, namespace, provider: peerTrustProvider });
  const store = new PeerContentAddressedStore({
    transport, peers, namespace, encryptionKey: key, replicaCount, minFailureDomains, verifyDurabilityReceipt,
    ...peerTrustProvider, failureDomainsByPeerId
  });
  // This read requires verified responses from the configured replica quorum.
  await store.listRefs();
  let repairLoop = null;
  if (String(process.env.APEX_PEER_CAS_REPAIR_ENABLED || 'true').toLowerCase() !== 'false') {
    repairLoop = store.startRepairLoop({
      intervalMs: Number(process.env.APEX_PEER_CAS_REPAIR_INTERVAL_MS || 30000),
      concurrency: Number(process.env.APEX_PEER_CAS_REPAIR_CONCURRENCY || 2),
      getCids: async () => {
        const refs = await store.listRefs();
        const cids = new Set();
        for (const ref of refs) collectReferencedCids(ref.value, cids);
        return [...cids];
      },
      onError: (error, cid) => console.error('[PEER CAS REPAIR]', JSON.stringify({
        namespace, cid, code: error?.code || null, error: String(error?.message || error)
      }))
    });
  }
  return Object.freeze({ store, namespace, peers, replicaCount, minFailureDomains, repairLoop });
}

export async function startPeerCasRuntime({ peerNode }) {
  if (!peerNode || typeof peerNode.dialProtocol !== 'function') throw new TypeError('started sovereign peer node required');
  const namespace = required('APEX_PEER_CAS_NAMESPACE');
  if (!APPS.has(namespace)) throw new Error('APEX_PEER_CAS_NAMESPACE must name one canonical app');
  const encodedKey = required('APEX_PEER_CAS_ENCRYPTION_KEY_BASE64_' + namespace.toUpperCase());
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encodedKey) throw new Error('Peer-CAS encryption key must be canonical base64 for exactly 32 bytes');
  const addressesByPeerId = parsePeers(required('APEX_PEER_CAS_PEERS'));
  const peers = Object.keys(addressesByPeerId);
  const transport = createLibp2pPeerStorageTransport({ node: peerNode, addressesByPeerId });
  const verifyDurabilityReceipt = await loadDurabilityReceiptVerifier();
  const peerTrustProvider = await loadPeerTrustProvider();
  const failureDomainsByPeerId = await attestConfiguredPeerRoots({ peers, namespace, provider: peerTrustProvider });
  const store = new PeerContentAddressedStore({
    transport, peers, namespace, encryptionKey: key, verifyDurabilityReceipt, ...peerTrustProvider,
    replicaCount: Number(process.env.APEX_PEER_CAS_REPLICAS || 2),
    minFailureDomains: Number(process.env.APEX_PEER_CAS_FAILURE_DOMAINS || 1),
    failureDomainsByPeerId
  });
  const allowed = new Set(required('APEX_PEER_CAS_ALLOWED_MODELS').split(';').map(x => x.trim()).filter(Boolean));
  if (!allowed.size || [...allowed].some(x => !/^[A-Za-z0-9._-]{1,128}@[A-Za-z0-9._-]{1,128}$/.test(x))) {
    throw new Error('APEX_PEER_CAS_ALLOWED_MODELS must list explicit modelId@revision entries');
  }
  const bridge = createPeerModelBridgeServer({
    store,
    authorizeModel: ({ namespace: app, modelId, revision }) => app === namespace && allowed.has(modelId + '@' + revision),
    token: required('APEX_PEER_CAS_TOKEN'),
    socketPath: process.env.APEX_PEER_CAS_SOCKET || '/tmp/apex_peer_cas.sock'
  });
  await bridge.listen();
  return Object.freeze({ store, bridge, namespace, peers });
}
