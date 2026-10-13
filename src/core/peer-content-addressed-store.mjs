import { createHash } from 'node:crypto';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value);

/**
 * Peer-backed immutable object replication primitive.
 * The transport must authenticate the remote libp2p identity and return it as
 * peerId. This class never falls back to local disk or lowers replica count.
 */
export class PeerContentAddressedStore {
  constructor({ transport, peers = [], replicaCount = 2 } = {}) {
    if (!transport || typeof transport.request !== 'function') {
      throw new TypeError('PeerContentAddressedStore requires an authenticated transport.request(peerId, request)');
    }
    this.transport = transport;
    this.peers = [...new Set(peers.map(String).filter(Boolean))];
    this.replicaCount = Number(replicaCount);
    if (!Number.isSafeInteger(this.replicaCount) || this.replicaCount < 1) {
      throw new TypeError('replicaCount must be a positive integer');
    }
    if (this.peers.length < this.replicaCount) {
      throw new Error('insufficient configured peers for requested replica count');
    }
  }

  async request(peerId, request) {
    const response = await this.transport.request(peerId, request);
    if (!response || response.peerId !== peerId || response.accepted !== true) {
      throw new Error('peer storage response identity or acceptance verification failed');
    }
    return response;
  }

  async putObject(value) {
    const bytes = Buffer.from(canonical(value), 'utf8');
    const hash = sha256(bytes);
    const receipts = [];
    const failures = [];
    for (const peerId of this.peers) {
      try {
        const response = await this.request(peerId, {
          protocol: 'apex.cas.v1',
          operation: 'object.put',
          hash,
          bytesBase64: bytes.toString('base64')
        });
        if (response.hash !== hash || response.bytes !== bytes.length) {
          throw new Error('peer returned an invalid object durability receipt');
        }
        receipts.push({ peerId, hash, bytes: response.bytes });
        if (receipts.length >= this.replicaCount) break;
      } catch (error) {
        failures.push({ peerId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (receipts.length < this.replicaCount) {
      const error = new Error('peer object write did not reach required replica count');
      error.code = 'INSUFFICIENT_REPLICAS';
      error.requiredReplicas = this.replicaCount;
      error.verifiedReplicas = receipts.length;
      error.failures = failures;
      throw error;
    }
    return {
      hash,
      bytes: bytes.length,
      uri: 'cas://sha256/' + hash,
      replicas: receipts.map(receipt => receipt.peerId),
      receipts
    };
  }

  async getObject(hash) {
    if (!/^[a-f0-9]{64}$/.test(String(hash))) throw new Error('invalid SHA-256 object id');
    const failures = [];
    for (const peerId of this.peers) {
      try {
        const response = await this.request(peerId, { protocol: 'apex.cas.v1', operation: 'object.get', hash });
        const bytes = Buffer.from(String(response.bytesBase64 || ''), 'base64');
        if (sha256(bytes) !== hash || response.hash !== hash) {
          throw new Error('peer returned content that failed SHA-256 verification');
        }
        return JSON.parse(bytes.toString('utf8'));
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    const error = new Error('object was not recoverable from any configured peer');
    error.code = 'OBJECT_UNAVAILABLE';
    error.failures = failures;
    throw error;
  }
}

/**
 * Server-side handler for a peer contributing durable object capacity.
 * store must be a persistent ContentAddressedStore owned by that peer.
 * The transport must invoke this only after authenticated peer allowlisting.
 */
export function createPeerObjectStorageHandler({ store, peerId, maxObjectBytes = 8 * 1024 * 1024 } = {}) {
  if (!store || typeof store.putObject !== 'function' || typeof store.getObject !== 'function') {
    throw new TypeError('a persistent content-addressed peer store is required');
  }
  if (!peerId) throw new TypeError('local peerId is required');
  const limit = Number(maxObjectBytes);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('maxObjectBytes must be a positive integer');

  return async function handlePeerObjectStorage(envelope, { remotePeerId = '' } = {}) {
    if (!remotePeerId) throw new Error('authenticated remote peer identity missing');
    if (envelope?.protocol !== 'apex.cas.v1') return false;
    if (envelope.operation === 'object.put') {
      if (typeof envelope.bytesBase64 !== 'string' || !/^[a-f0-9]{64}$/.test(String(envelope.hash || ''))) {
        throw new Error('invalid peer object write request');
      }
      const bytes = Buffer.from(envelope.bytesBase64, 'base64');
      if (bytes.length > limit || bytes.toString('base64') !== envelope.bytesBase64) {
        throw new Error('peer object write exceeds size limit or is not canonical base64');
      }
      if (sha256(bytes) !== envelope.hash) throw new Error('peer object write hash mismatch');
      let value;
      try { value = JSON.parse(bytes.toString('utf8')); }
      catch { throw new Error('peer object payload is not valid JSON'); }
      const saved = await store.putObject(value);
      if (saved.hash !== envelope.hash || saved.bytes !== bytes.length) {
        throw new Error('persistent peer store did not preserve the requested object');
      }
      return { accepted: true, peerId, hash: saved.hash, bytes: saved.bytes };
    }
    if (envelope.operation === 'object.get') {
      if (!/^[a-f0-9]{64}$/.test(String(envelope.hash || ''))) throw new Error('invalid peer object read request');
      const value = await store.getObject(envelope.hash);
      const bytes = Buffer.from(canonical(value), 'utf8');
      if (sha256(bytes) !== envelope.hash) throw new Error('persistent peer object failed integrity verification');
      return { accepted: true, peerId, hash: envelope.hash, bytesBase64: bytes.toString('base64') };
    }
    throw new Error('unsupported peer storage operation');
  };
}
