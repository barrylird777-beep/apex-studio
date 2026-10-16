import { PeerContentAddressedStore } from './peer-content-addressed-store.mjs';
import { createLibp2pPeerStorageTransport } from './peer-storage-libp2p-transport.mjs';
import { createPeerModelBridgeServer } from './peer-model-bridge.mjs';
import { discoverCapacityQualifiedPeers } from './peer-capacity-placement.mjs';

const APPS = new Set(['KernelVision', 'XShield', 'Kernelodies', 'PlanetApeX', 'KashKorner', 'KoinKob']);

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(name + ' is required; Peer-CAS stays disabled');
  return value;
}

function parsePeers(value) {
  const result = Object.create(null);
  for (const entry of value.split(';')) {
    const split = entry.indexOf('=');
    if (split < 1) throw new Error('APEX_PEER_CAS_PEERS must use peerId=/ip4/.../tcp/.../p2p/peerId entries separated by semicolons');
    const id = entry.slice(0, split).trim();
    const address = entry.slice(split + 1).trim();
    const match = address.match(/\\/p2p\\/([^/]+)$/);
    if (!id || !match || match[1] !== id || result[id]) throw new Error('invalid or duplicate Peer-CAS peer address');
    result[id] = address;
  }
  if (!Object.keys(result).length) throw new Error('at least one explicit Peer-CAS storage peer is required');
  return result;
}

function parseTrustedDomains(value) {
  const result = Object.create(null);
  for (const entry of value.split(';')) {
    const split = entry.indexOf('=');
    if (split < 1) throw new Error('APEX_PEER_TRUSTED_FAILURE_DOMAINS must use peerId=trusted-domain entries separated by semicolons');
    const id = entry.slice(0, split).trim();
    const domain = entry.slice(split + 1).trim();
    if (!id || !domain || result[id]) throw new Error('invalid or duplicate trusted peer failure-domain entry');
    result[id] = domain;
  }
  if (!Object.keys(result).length) throw new Error('trusted peer failure-domain registry is empty');
  return result;
}

async function resolveCapacityQualifiedPeers({ transport, namespace, configuredPeers, replicaCount, minFailureDomains }) {
  const trustedFailureDomains = parseTrustedDomains(required('APEX_PEER_TRUSTED_FAILURE_DOMAINS'));
  const minUsableBytes = Number(process.env.APEX_PEER_CAS_MIN_USABLE_BYTES || 1);
  const result = await discoverCapacityQualifiedPeers({
    peers: configuredPeers,
    transport,
    namespace,
    trustedFailureDomains,
    minUsableBytes
  });
  const qualified = result.qualified;
  const domains = new Set(qualified.map(peer => peer.failureDomain));
  if (qualified.length < replicaCount || domains.size < minFailureDomains) {
    const error = new Error('peer placement refused: fresh authenticated capacity reports do not satisfy replica and trusted failure-domain policy');
    error.code = 'INSUFFICIENT_QUALIFIED_PEERS';
    error.requiredReplicas = replicaCount;
    error.qualifiedPeers = qualified.map(peer => peer.peerId);
    error.requiredFailureDomains = minFailureDomains;
    error.qualifiedFailureDomains = [...domains];
    error.rejected = result.rejected;
    throw error;
  }
  return { peers: qualified.map(peer => peer.peerId), trustedFailureDomains, capacityReports: qualified, rejected: result.rejected };
}

/** Create the app-scoped peer CAS used by the mesh engine; no model bridge. */
export async function createPeerMeshCasRuntime({ peerNode } = {}) {
  if (!peerNode || typeof peerNode.dialProtocol !== 'function') throw new TypeError('started sovereign peer node required');
  const namespace = required('APEX_PEER_CAS_NAMESPACE');
  if (!APPS.has(namespace)) throw new Error('APEX_PEER_CAS_NAMESPACE must name one canonical app');
  const encodedKey = required('APEX_PEER_CAS_ENCRYPTION_KEY_BASE64');
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encodedKey) throw new Error('Peer-CAS encryption key must be canonical base64 for exactly 32 bytes');
  const addressesByPeerId = parsePeers(required('APEX_PEER_CAS_PEERS'));
  const configuredPeers = Object.keys(addressesByPeerId);
  const replicaCount = Number(process.env.APEX_PEER_CAS_REPLICAS || 2);
  const minFailureDomains = Number(process.env.APEX_PEER_CAS_FAILURE_DOMAINS || 2);
  if (!Number.isSafeInteger(replicaCount) || replicaCount < 1 || configuredPeers.length < replicaCount) throw new Error('mesh startup refused: configured peer set is below the required replica count');
  if (!Number.isSafeInteger(minFailureDomains) || minFailureDomains < 1 || minFailureDomains > replicaCount) throw new Error('mesh startup refused: invalid independent failure-domain policy');
  const transport = createLibp2pPeerStorageTransport({ node: peerNode, addressesByPeerId });
  const placement = await resolveCapacityQualifiedPeers({ transport, namespace, configuredPeers, replicaCount, minFailureDomains });
  const store = new PeerContentAddressedStore({
    transport, peers: placement.peers, namespace, encryptionKey: key, replicaCount, minFailureDomains,
    failureDomainsByPeerId: Object.fromEntries(placement.capacityReports.map(peer => [peer.peerId, peer.failureDomain]))
  });
  // This read requires verified responses from the configured replica quorum.
  await store.listRefs();
  return Object.freeze({ store, namespace, peers: placement.peers, replicaCount, minFailureDomains, capacityReports: placement.capacityReports, rejectedCapacityReports: placement.rejected });
}

export async function startPeerCasRuntime({ peerNode }) {
  if (!peerNode || typeof peerNode.dialProtocol !== 'function') throw new TypeError('started sovereign peer node required');
  const namespace = required('APEX_PEER_CAS_NAMESPACE');
  if (!APPS.has(namespace)) throw new Error('APEX_PEER_CAS_NAMESPACE must name one canonical app');
  const encodedKey = required('APEX_PEER_CAS_ENCRYPTION_KEY_BASE64');
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encodedKey) throw new Error('Peer-CAS encryption key must be canonical base64 for exactly 32 bytes');
  const addressesByPeerId = parsePeers(required('APEX_PEER_CAS_PEERS'));
  const configuredPeers = Object.keys(addressesByPeerId);
  const replicaCount = Number(process.env.APEX_PEER_CAS_REPLICAS || 2);
  const minFailureDomains = Number(process.env.APEX_PEER_CAS_FAILURE_DOMAINS || 2);
  if (!Number.isSafeInteger(replicaCount) || replicaCount < 1 || configuredPeers.length < replicaCount) throw new Error('mesh startup refused: configured peer set is below the required replica count');
  if (!Number.isSafeInteger(minFailureDomains) || minFailureDomains < 1 || minFailureDomains > replicaCount) throw new Error('mesh startup refused: invalid independent failure-domain policy');
  const transport = createLibp2pPeerStorageTransport({ node: peerNode, addressesByPeerId });
  const placement = await resolveCapacityQualifiedPeers({ transport, namespace, configuredPeers, replicaCount, minFailureDomains });
  const store = new PeerContentAddressedStore({
    transport, peers: placement.peers, namespace, encryptionKey: key, replicaCount, minFailureDomains,
    failureDomainsByPeerId: Object.fromEntries(placement.capacityReports.map(peer => [peer.peerId, peer.failureDomain]))
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
  return Object.freeze({ store, bridge, namespace, peers: placement.peers, capacityReports: placement.capacityReports, rejectedCapacityReports: placement.rejected });
}
