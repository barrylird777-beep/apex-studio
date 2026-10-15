import { PeerContentAddressedStore } from './peer-content-addressed-store.mjs';
import { createLibp2pPeerStorageTransport } from './peer-storage-libp2p-transport.mjs';
import { createPeerModelBridgeServer } from './peer-model-bridge.mjs';

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
    const match = address.match(/\/p2p\/([^/]+)$/);
    if (!id || !match || match[1] !== id || result[id]) throw new Error('invalid or duplicate Peer-CAS peer address');
    result[id] = address;
  }
  if (!Object.keys(result).length) throw new Error('at least one explicit Peer-CAS storage peer is required');
  return result;
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
  const store = new PeerContentAddressedStore({
    transport, peers, namespace, encryptionKey: key, replicaCount, minFailureDomains,
    failureDomainsByPeerId: Object.fromEntries(peers.map(id => [id, String(process.env['APEX_PEER_FAILURE_DOMAIN_' + id] || '')]))
  });
  // This read requires verified responses from the configured replica quorum.
  await store.listRefs();
  return Object.freeze({ store, namespace, peers, replicaCount, minFailureDomains });
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
  const store = new PeerContentAddressedStore({
    transport, peers, namespace, encryptionKey: key,
    replicaCount: Number(process.env.APEX_PEER_CAS_REPLICAS || 2),
    minFailureDomains: Number(process.env.APEX_PEER_CAS_FAILURE_DOMAINS || 1),
    failureDomainsByPeerId: Object.fromEntries(peers.map(id => [id, String(process.env['APEX_PEER_FAILURE_DOMAIN_' + id] || '')]))
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
