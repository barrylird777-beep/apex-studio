import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PeerContentAddressedStore } from './peer-content-addressed-store.mjs';
import { createLibp2pPeerStorageTransport } from './peer-storage-libp2p-transport.mjs';
import { createPeerMediaStore, APEX_MEDIA_APPS } from './peer-media-store.mjs';

const suffix = app => app.replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]/g, '_').toUpperCase();
const parsePeerTargets = (raw, app) => {
  const entries = String(raw || '').split(';').map(value => value.trim()).filter(Boolean);
  const result = [];
  for (const entry of entries) {
    const split = entry.indexOf('@');
    if (split < 1) throw new Error('peer target must use peerId@multiaddr syntax for ' + app);
    const peerId = entry.slice(0, split).trim();
    const address = entry.slice(split + 1).trim();
    if (!peerId || !address.endsWith('/p2p/' + peerId)) {
      throw new Error('peer target multiaddress must end with the exact peer ID for ' + app);
    }
    result.push({ peerId, address });
  }
  if (!result.length) throw new Error('no remote storage peers configured for ' + app);
  if (new Set(result.map(item => item.peerId)).size !== result.length) throw new Error('duplicate remote storage peer for ' + app);
  return result;
};
const parseFailureDomains = raw => Object.fromEntries(String(raw || '').split(';').map(value => value.trim()).filter(Boolean).map(entry => {
  const split = entry.indexOf('=');
  if (split < 1) throw new Error('failure domains must use peerId=domain;peerId=domain syntax');
  return [entry.slice(0, split).trim(), entry.slice(split + 1).trim()];
}));

function validateBackend(backend) {
  const required = ['putBytes', 'getBytes', 'readRef', 'writeRef'];
  if (!backend || required.some(name => typeof backend[name] !== 'function') || backend.durable !== true ||
      backend.ownership !== 'peer-owned') {
    throw new Error('peer storage backend must declare durable=true and ownership=peer-owned and implement putBytes/getBytes/readRef/writeRef; local or ephemeral stores are rejected');
  }
  return backend;
}

/**
 * Assemble one app-isolated outbound media client and this peer's inbound
 * capacity backend. Each deployment handles exactly one canonical app namespace.
 * Storage, peers, keys, and replica policy must be explicitly provisioned.
 */
export async function createPeerStorageAssembly({ peerNode, env = process.env } = {}) {
  if (!peerNode || typeof peerNode.dialProtocol !== 'function') throw new TypeError('active libp2p peer node is required');
  const app = String(env.APEX_APP_ID || '').trim();
  if (!APEX_MEDIA_APPS.includes(app)) throw new Error('APEX_APP_ID must identify exactly one canonical app namespace');
  const backendSpecifier = String(env.APEX_PEER_STORAGE_BACKEND_MODULE || (env.APEX_PEER_STORAGE_UPSTREAM ? new URL('./peer-network-storage-backend.mjs', import.meta.url).href : '')).trim();
  if (!backendSpecifier) throw new Error('configure APEX_PEER_STORAGE_BACKEND_MODULE or APEX_PEER_STORAGE_UPSTREAM; local fallback is forbidden');
  const backendUrl = backendSpecifier.startsWith('file:')
    ? backendSpecifier
    : pathToFileURL(path.resolve(backendSpecifier)).href;
  const backendModule = await import(backendUrl);
  if (typeof backendModule.createPeerStorageBackend !== 'function') {
    throw new Error('peer-owned backend module must export createPeerStorageBackend({ peerId, env })');
  }
  const backend = validateBackend(await backendModule.createPeerStorageBackend({
    peerId: peerNode.peerId.toString(), peerNode, env
  }));

  const replicaCount = Number(env.APEX_PEER_STORAGE_REPLICA_COUNT || 2);
  const minFailureDomains = Number(env.APEX_PEER_STORAGE_MIN_FAILURE_DOMAINS || 1);
  if (!Number.isSafeInteger(replicaCount) || replicaCount < 1 ||
      !Number.isSafeInteger(minFailureDomains) || minFailureDomains < 1 || minFailureDomains > replicaCount) {
    throw new Error('invalid peer storage replica or failure-domain policy');
  }
  const failureDomainsByPeerId = parseFailureDomains(env.APEX_PEER_STORAGE_FAILURE_DOMAINS);
  const peerStores = Object.create(null);
  {
    const keyName = 'APEX_PEER_STORAGE_KEY_' + suffix(app);
    const peersName = 'APEX_PEER_STORAGE_PEERS_' + suffix(app);
    const encodedKey = String(env[keyName] || '').trim();
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encodedKey)) {
      throw new Error(keyName + ' must be a base64-encoded 32-byte AES-256 key');
    }
    const encryptionKey = Buffer.from(encodedKey, 'base64');
    if (encryptionKey.length !== 32 || encryptionKey.toString('base64') !== encodedKey) {
      throw new Error(keyName + ' must be a canonical base64-encoded 32-byte AES-256 key');
    }
    const targets = parsePeerTargets(env[peersName], app);
    if (targets.length < replicaCount) throw new Error(peersName + ' has fewer peers than the configured replica count');
    const addressesByPeerId = Object.fromEntries(targets.map(target => [target.peerId, target.address]));
    const transport = createLibp2pPeerStorageTransport({ node: peerNode, addressesByPeerId });
    peerStores[app] = new PeerContentAddressedStore({
      transport,
      peers: targets.map(target => target.peerId),
      replicaCount,
      minFailureDomains,
      failureDomainsByPeerId,
      maxObjectBytes: 32 * 1024,
      namespace: app,
      encryptionKey
    });
  }
  const mediaStore = createPeerMediaStore({ peerStores, apps: [app] });
  return Object.freeze({ backend, mediaStore, peerStores });
}
