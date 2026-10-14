import { sendToPeer } from './sovereign-peer.mjs';

/**
 * Authenticated peer transport adapter for the APEX CAS protocol.
 *
 * This maps configured libp2p peer IDs to their advertised multiaddresses.
 * It deliberately provides no local queue, disk fallback, or implicit discovery
 * trust. The existing sovereign transport authenticates the remote peer; this
 * adapter additionally verifies that the response came from the intended ID
 * and preserved the app namespace.
 */
export function createPeerCasTransport({ node, peerAddresses = {} } = {}) {
  if (!node || typeof node.dialProtocol !== 'function' || !node.peerId) {
    throw new TypeError('peer CAS transport requires a started libp2p node');
  }

  const addresses = new Map();
  for (const [peerIdValue, addressValue] of Object.entries(peerAddresses)) {
    const peerId = String(peerIdValue || '').trim();
    const address = String(addressValue || '').trim();
    const suffix = address.match(/\/p2p\/([^/]+)$/)?.[1] || '';
    if (!peerId || !address || suffix !== peerId) {
      throw new TypeError('each CAS peer address must end in the matching /p2p/<peerId>');
    }
    if (peerId === node.peerId.toString()) {
      throw new Error('local peer cannot be configured as a remote CAS replica');
    }
    addresses.set(peerId, address);
  }

  return Object.freeze({
    async request(peerIdValue, envelope) {
      const peerId = String(peerIdValue || '');
      const address = addresses.get(peerId);
      if (!address) {
        const error = new Error('CAS destination is not in the explicit peer-address allowlist');
        error.code = 'CAS_PEER_NOT_CONFIGURED';
        throw error;
      }
      if (!envelope || envelope.protocol !== 'apex.cas.v1' ||
          typeof envelope.namespace !== 'string' || !envelope.namespace) {
        throw new TypeError('CAS request must include protocol and app namespace');
      }
      const response = await sendToPeer(node, address, envelope);
      if (!response || response.accepted !== true || response.peerId !== peerId ||
          response.namespace !== envelope.namespace) {
        const error = new Error('CAS response failed peer identity, acceptance, or namespace verification');
        error.code = 'CAS_RESPONSE_IDENTITY_MISMATCH';
        throw error;
      }
      return response;
    }
  });
}
