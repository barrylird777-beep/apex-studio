import { createPublicKey } from 'node:crypto';
import { PeerContentAddressedStore } from './peer-content-addressed-store.mjs';
import { createLibp2pPeerStorageTransport } from './peer-storage-libp2p-transport.mjs';
import { createPeerModelBridgeServer } from './peer-model-bridge.mjs';

const APPS = new Set(['KernelVision', 'XShield', 'Kernelodies', 'PlanetApeX', 'KashKorner', 'KoinKob']);

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(name + ' is required; Peer-CAS stays disabled');
  return value;
}

function parseReceiptPublicKeys(value, peerIds) {
  const result = Object.create(null);
  for (const entry of String(value || '').split(';').filter(Boolean)) {
    const split = entry.indexOf('=');
    if (split < 1) throw new Error('APEX_PEER_CAS_RECEIPT_PUBLIC_KEYS must use peerId=base64-SPKI entries separated by semicolons');
    const peerId = entry.slice(0, split).trim();
    const encoded = entry.slice(split + 1).trim();
    const der = Buffer.from(encoded, 'base64');
    if (!peerId || !encoded || der.toString('base64') !== encoded || result[peerId]) {
      throw new Error('invalid or duplicate peer receipt public key');
    }
    result[peerId] = encoded;
  }
  for (const peerId of peerIds) {
    if (!result[peerId]) throw new Error('missing pinned Ed25519 receipt public key for configured peer ' + peerId);
    const key = createPublicKey({ key: Buffer.from(result[peerId], 'base64'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('receipt verification key must be Ed25519 for peer ' + peerId);
  }
  if (Object.keys(result).some(peerId => !peerIds.includes(peerId))) {
    throw new Error('receipt public-key map contains an unconfigured peer');
  }
  return result;
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
export async function createPeerMeshCasRuntime({ peerNode } = {}) {
  if (!peerNode || typeof peerNode.dialProtocol !== 'function') throw new TypeError('started sovereign peer node required');
  const namespace = required('APEX_PEER_CAS_NAMESPACE');
  if (!APPS.has(namespace)) throw new Error('APEX_PEER_CAS_NAMESPACE must name one canonical app');
  const encodedKey = required('APEX_PEER_CAS_ENCRYPTION_KEY_BASE64');
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encodedKey) throw new Error('Peer-CAS encryption key must be canonical base64 for exactly 32 bytes');
  const addressesByPeerId = parsePeers(required('APEX_PEER_CAS_PEERS'));
  const peers = Object.keys(addressesByPeerId);
  const replicaCount = Number(process.env.APEX_PEER_CAS_REPLICAS || 2);
  const minFailureDomains = Number(process.env.APEX_PEER_CAS_FAILURE_DOMAINS || replicaCount);
  if (peers.length < replicaCount) throw new Error('mesh startup refused: configured peer set is below the required replica count');
  const receiptPublicKeysByPeerId = parseReceiptPublicKeys(required('APEX_PEER_CAS_RECEIPT_PUBLIC_KEYS'), peers);
  const transport = createLibp2pPeerStorageTransport({ node: peerNode, addressesByPeerId });
  const store = new PeerContentAddressedStore({
    transport, peers, namespace, encryptionKey: key, replicaCount, minFailureDomains,
    failureDomainsByPeerId: Object.fromEntries(peers.map(id => [id, String(process.env['APEX_PEER_FAILURE_DOMAIN_' + id] || '')])),
    receiptPublicKeysByPeerId
  });
  // This read requires verified responses from the configured replica quorum.
  await store.listRefs();
  return Object.freeze({ store, namespace, peers, replicaCount, minFailureDomains });
}

export async function startPeerCasRuntime({ peerNode }) {
  if (!peerNode || typeof peerNode.dialProtocol !== 'function') throw new TypeError('started sovereign peer node required');
  const namespace = required('APEX_PEER_CAS_NAMESPACE');
  if (!APPS.has(namespace)) throw new Error('APEX_PEER_CAS_NAMESPACE must name one canonical app');
  const encodedKey = required('APEX_PEER_CAS_ENCRYPTION_KEY_BASE64');
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encodedKey) throw new Error('Peer-CAS encryption key must be canonical base64 for exactly 32 bytes');
  const addressesByPeerId = parsePeers(required('APEX_PEER_CAS_PEERS'));
  const peers = Object.keys(addressesByPeerId);
  const receiptPublicKeysByPeerId = parseReceiptPublicKeys(required('APEX_PEER_CAS_RECEIPT_PUBLIC_KEYS'), peers);
  const transport = createLibp2pPeerStorageTransport({ node: peerNode, addressesByPeerId });
  const store = new PeerContentAddressedStore({
    transport, peers, namespace, encryptionKey: key,
    replicaCount: Number(process.env.APEX_PEER_CAS_REPLICAS || 2),
    minFailureDomains: Number(process.env.APEX_PEER_CAS_FAILURE_DOMAINS || process.env.APEX_PEER_CAS_REPLICAS || 2),
    failureDomainsByPeerId: Object.fromEntries(peers.map(id => [id, String(process.env['APEX_PEER_FAILURE_DOMAIN_' + id] || '')])),
    receiptPublicKeysByPeerId
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
