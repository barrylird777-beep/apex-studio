import { createHash } from 'node:crypto';
import path from 'node:path';
import { decodeCanonical } from './apex-cbor.mjs';
import { createLibp2pPeerStorageTransport } from './peer-storage-libp2p-transport.mjs';
import { APEX_MEDIA_APPS } from './peer-media-store.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/**
 * Network-only backend adapter. It stores no bytes locally: every operation is
 * forwarded to an explicitly identified peer that must prove durable, peer-owned
 * capacity before this adapter advertises durability.
 */
export async function createPeerStorageBackend({ peerId, peerNode, env = process.env } = {}) {
  if (!peerNode || typeof peerNode.dialProtocol !== 'function') {
    throw new TypeError('peerNode is required for the peer-network backend');
  }
  const app = String(env.APEX_APP_ID || '').trim();
  if (!APEX_MEDIA_APPS.includes(app)) throw new Error('APEX_APP_ID must identify one canonical app');
  const raw = String(env.APEX_PEER_STORAGE_UPSTREAM || '').trim();
  const split = raw.indexOf('@');
  if (split < 1) throw new Error('APEX_PEER_STORAGE_UPSTREAM must use peerId@multiaddr syntax');
  const upstreamPeerId = raw.slice(0, split).trim();
  const upstreamAddress = raw.slice(split + 1).trim();
  if (!upstreamPeerId || !upstreamAddress.endsWith('/p2p/' + upstreamPeerId)) {
    throw new Error('upstream multiaddress must end with the exact upstream peer ID');
  }
  if (upstreamPeerId === String(peerId || peerNode.peerId?.toString?.() || '')) {
    throw new Error('peer-network backend cannot forward to itself');
  }
  const transport = createLibp2pPeerStorageTransport({
    node: peerNode,
    addressesByPeerId: { [upstreamPeerId]: upstreamAddress }
  });
  const request = async envelope => {
    const result = await transport.request(upstreamPeerId, envelope);
    if (result.namespace !== app) throw new Error('upstream returned a cross-app namespace response');
    return result;
  };
  const capability = await request({ protocol: 'apex.cas.v1', operation: 'storage.health', namespace: app });
  if (capability.durable !== true || capability.ownership !== 'peer-owned') {
    throw new Error('upstream peer did not prove durable peer-owned storage capacity');
  }

  return Object.freeze({
    durable: true,
    ownership: 'peer-owned',
    upstreamPeerId,
    async putBytes(hash, input) {
      const bytes = Buffer.from(input);
      if (!/^[a-f0-9]{64}$/.test(String(hash)) || sha256(bytes) !== hash) {
        throw new Error('peer-network backend rejected a non-canonical object hash');
      }
      const envelope = decodeCanonical(bytes);
      if (envelope?.namespace !== app || envelope?.algorithm !== 'aes-256-gcm' || envelope?.version !== 1) {
        throw new Error('peer-network backend rejected a cross-app or unencrypted object');
      }
      const result = await request({
        protocol: 'apex.cas.v1', operation: 'object.put', namespace: app,
        hash, bytesBase64: bytes.toString('base64')
      });
      if (result.hash !== hash || result.bytes !== bytes.length || result.durable !== true || result.ownership !== 'peer-owned') {
        throw new Error('upstream object receipt did not prove durable peer-owned storage');
      }
      return { hash, bytes: bytes.length };
    },
    async getBytes(hash) {
      if (!/^[a-f0-9]{64}$/.test(String(hash))) throw new Error('invalid object hash');
      const result = await request({ protocol: 'apex.cas.v1', operation: 'object.get', namespace: app, hash });
      const bytes = Buffer.from(String(result.bytesBase64 || ''), 'base64');
      if (bytes.toString('base64') !== result.bytesBase64 || sha256(bytes) !== hash ||
          result.hash !== hash || result.durable !== true || result.ownership !== 'peer-owned') {
        throw new Error('upstream object read failed integrity or durability verification');
      }
      return bytes;
    },
    async readRef(namespace, key) {
      if (namespace !== app) throw new Error('peer-network backend rejected a cross-app reference read');
      const result = await request({ protocol: 'apex.cas.v1', operation: 'ref.get', namespace, key });
      if (result.hash == null) return null;
      const bytes = Buffer.from(String(result.bytesBase64 || ''), 'base64');
      if (bytes.toString('base64') !== result.bytesBase64 || sha256(bytes) !== result.hash ||
          result.durable !== true || result.ownership !== 'peer-owned') {
        throw new Error('upstream reference read failed integrity or durability verification');
      }
      return { hash: result.hash, bytes };
    },
    async writeRef(namespace, key, expectedHash, hash, input) {
      if (namespace !== app) throw new Error('peer-network backend rejected a cross-app reference write');
      const bytes = Buffer.from(input);
      if (!/^[a-f0-9]{64}$/.test(String(hash)) || sha256(bytes) !== hash) {
        throw new Error('peer-network backend rejected a non-canonical reference hash');
      }
      const result = await request({
        protocol: 'apex.cas.v1', operation: 'ref.cas', namespace, key, expectedHash,
        hash, bytesBase64: bytes.toString('base64')
      });
      if (result.hash !== hash || result.durable !== true || result.ownership !== 'peer-owned') {
        throw new Error('upstream reference receipt did not prove durable peer-owned storage');
      }
      return { hash };
    }
  });
}
