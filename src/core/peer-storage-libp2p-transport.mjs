import { sendToPeerAuto } from '../network/sovereign-peer.mjs';

/**
 * Adapts the existing authenticated libp2p request/ACK path to peer CAS.
 * Addresses must be explicitly provisioned and end with the exact peer ID.
 * This does not discover peers or weaken the sovereign-peer allowlist.
 */
export function createLibp2pPeerStorageTransport({ node, addressesByPeerId, send = sendToPeerAuto } = {}) {
  if (!node || typeof node.dialProtocol !== 'function') {
    throw new TypeError('an active libp2p node is required');
  }
  if (!addressesByPeerId || typeof addressesByPeerId !== 'object' || Array.isArray(addressesByPeerId)) {
    throw new TypeError('an explicit peer-ID-to-multiaddress map is required');
  }
  if (typeof send !== 'function') throw new TypeError('send must be a function');

  const addresses = new Map();
  for (const [peerIdRaw, addressRaw] of Object.entries(addressesByPeerId)) {
    const peerId = String(peerIdRaw).trim();
    const address = String(addressRaw).trim();
    const match = address.match(/\/p2p\/([^/]+)$/);
    if (!peerId || !match || match[1] !== peerId) {
      throw new Error('peer storage address must terminate in its exact configured peer ID');
    }
    addresses.set(peerId, address);
  }

  return Object.freeze({
    async request(peerIdRaw, envelope) {
      const peerId = String(peerIdRaw || '');
      const address = addresses.get(peerId);
      if (!address) throw new Error('peer storage target is not explicitly configured');
      if (!envelope || envelope.protocol !== 'apex.cas.v1') {
        throw new Error('unsupported peer storage protocol');
      }
      const response = await send(node, address, envelope);
      if (!response || response.accepted !== true || response.peerId !== peerId) {
        throw new Error('peer storage transport returned an unexpected authenticated identity');
      }
      return response;
    }
  });
}
