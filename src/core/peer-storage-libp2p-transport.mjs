import { sendToPeer } from '../network/sovereign-peer.mjs';
import { ConnectionTrustSessions } from './peer-runtime-controls.mjs';

/**
 * Adapts the existing authenticated libp2p request/ACK path to peer CAS.
 * Addresses must be explicitly provisioned and end with the exact peer ID.
 * This does not discover peers or weaken the sovereign-peer allowlist.
 */
export function createLibp2pPeerStorageTransport({ node, addressesByPeerId, send = sendToPeer, appNamespace = null, connectionTrust = null } = {}) {
  if (!node || typeof node.dialProtocol !== 'function') {
    throw new TypeError('an active libp2p node is required');
  }
  if (!addressesByPeerId || typeof addressesByPeerId !== 'object' || Array.isArray(addressesByPeerId)) {
    throw new TypeError('an explicit peer-ID-to-multiaddress map is required');
  }
  if (typeof send !== 'function') throw new TypeError('send must be a function');
  const trustSessions = connectionTrust ? new ConnectionTrustSessions() : null;
  if (connectionTrust) {
    if (!['KernelVision', 'XShield', 'Kernelodies', 'PlanetApeX', 'KashKorner', 'KoinKob'].includes(appNamespace) ||
        !['getConnectionForStream', 'getConnectionCredentialFingerprint', 'attestConnection',
          'verifyConnectionCredential', 'verifyConnectionAttestation'].every(name => typeof connectionTrust[name] === 'function')) {
      throw new TypeError('connection trust requires a canonical app and complete platform-backed attestation callbacks');
    }
  }
  const authorizeConnection = connectionTrust ? async ({ node: activeNode, stream, destinationPeerId }) => {
    const connection = await connectionTrust.getConnectionForStream({
      node: activeNode, stream, peerId: destinationPeerId, app: appNamespace
    });
    if (!connection || connection.closed === true ||
        String(connection.remotePeer?.toString?.() || '') !== destinationPeerId) {
      throw new Error('connection trust gate could not bind the stream to the authenticated peer connection');
    }
    const credentialFingerprint = await connectionTrust.getConnectionCredentialFingerprint({
      connection, peerId: destinationPeerId, app: appNamespace
    });
    if (typeof credentialFingerprint !== 'string' || !credentialFingerprint) {
      throw new Error('connection trust gate requires a stable credential fingerprint');
    }
    if (trustSessions.isElevated(connection, credentialFingerprint)) return;
    const challenge = trustSessions.createChallenge(connection, credentialFingerprint);
    const attestation = await connectionTrust.attestConnection({
      connection, peerId: destinationPeerId, app: appNamespace, challenge, credentialFingerprint
    });
    await trustSessions.elevate(connection, {
      credentialFingerprint, attestation,
      verifyCredential: (liveConnection, context) => connectionTrust.verifyConnectionCredential(
        liveConnection, { ...context, peerId: destinationPeerId, app: appNamespace }),
      verifyAttestation: (evidence, liveConnection, context) => connectionTrust.verifyConnectionAttestation(
        evidence, liveConnection, { ...context, peerId: destinationPeerId, app: appNamespace })
    });
  } : null;

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
      const response = await send(node, address, envelope, { authorizeConnection });
      if (!response || response.accepted !== true || response.peerId !== peerId) {
        throw new Error('peer storage transport returned an unexpected authenticated identity');
      }
      return response;
    }
  });
}
