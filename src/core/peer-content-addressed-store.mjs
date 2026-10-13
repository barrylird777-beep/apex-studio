import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value);
const validNamespace = value => /^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(String(value || ''));

/**
 * Peer-backed immutable object replication primitive.
 * Objects are AES-256-GCM encrypted before leaving the writer. Transport must
 * authenticate remote libp2p identities. There is no local-disk fallback.
 */
export class PeerContentAddressedStore {
  constructor({ transport, peers = [], replicaCount = 2, minFailureDomains = 1, failureDomainsByPeerId = {}, maxObjectBytes = 32 * 1024, namespace, encryptionKey } = {}) {
    if (!transport || typeof transport.request !== 'function') {
      throw new TypeError('PeerContentAddressedStore requires an authenticated transport.request(peerId, request)');
    }
    if (!validNamespace(namespace)) throw new TypeError('a valid per-app namespace is required');
    const key = typeof encryptionKey === 'string' ? Buffer.from(encryptionKey, 'base64') : Buffer.from(encryptionKey || []);
    if (key.length !== 32) throw new TypeError('encryptionKey must be a 32-byte AES-256 key');
    this.transport = transport;
    this.peers = [...new Set(peers.map(String).filter(Boolean))];
    this.replicaCount = Number(replicaCount);
    this.minFailureDomains = Number(minFailureDomains);
    this.failureDomainsByPeerId = Object.fromEntries(Object.entries(failureDomainsByPeerId || {}).map(([id, domain]) => [String(id), String(domain || '').trim()]));
    this.namespace = namespace;
    this.encryptionKey = key;
    this.maxObjectBytes = Number(maxObjectBytes);
    if (!Number.isSafeInteger(this.maxObjectBytes) || this.maxObjectBytes < 1 || this.maxObjectBytes > 32 * 1024) {
      throw new TypeError('maxObjectBytes must be between 1 byte and 32 KiB until authenticated transport chunking is implemented');
    }
    if (!Number.isSafeInteger(this.replicaCount) || this.replicaCount < 1) {
      throw new TypeError('replicaCount must be a positive integer');
    }
    if (this.peers.length < this.replicaCount) {
      throw new Error('insufficient configured peers for requested replica count');
    }
    if (!Number.isSafeInteger(this.minFailureDomains) || this.minFailureDomains < 1 || this.minFailureDomains > this.replicaCount) {
      throw new TypeError('minFailureDomains must be between one and replicaCount');
    }
    if (this.minFailureDomains > 1) {
      for (const peerId of this.peers) {
        if (!this.failureDomainsByPeerId[peerId]) throw new Error('every configured peer needs an explicit failure domain when minFailureDomains > 1');
      }
      if (new Set(this.peers.map(peerId => this.failureDomainsByPeerId[peerId])).size < this.minFailureDomains) {
        throw new Error('insufficient configured failure domains for requested durability policy');
      }
    }
  }

  encrypt(value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const plaintext = Buffer.from(canonical(value), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      version: 1,
      algorithm: 'aes-256-gcm',
      namespace: this.namespace,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64')
    };
  }

  decrypt(envelope) {
    if (!envelope || envelope.version !== 1 || envelope.algorithm !== 'aes-256-gcm' ||
        envelope.namespace !== this.namespace) {
      throw new Error('encrypted object version, algorithm, or app namespace mismatch');
    }
    const iv = Buffer.from(String(envelope.iv || ''), 'base64');
    const tag = Buffer.from(String(envelope.tag || ''), 'base64');
    const ciphertext = Buffer.from(String(envelope.ciphertext || ''), 'base64');
    if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length) throw new Error('invalid encrypted object envelope');
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  }

  async request(peerId, request) {
    const response = await this.transport.request(peerId, request);
    if (!response || response.peerId !== peerId || response.accepted !== true) {
      throw new Error('peer storage response identity or acceptance verification failed');
    }
    return response;
  }

  async putObject(value) {
    const bytes = Buffer.from(canonical(this.encrypt(value)), 'utf8');
    if (bytes.length > this.maxObjectBytes) {
      const error = new Error('encrypted object exceeds the safe single-envelope limit; chunking is required');
      error.code = 'OBJECT_TOO_LARGE_REQUIRES_CHUNKING';
      error.bytes = bytes.length;
      error.maxObjectBytes = this.maxObjectBytes;
      throw error;
    }
    const hash = sha256(bytes);
    const receipts = [];
    const failures = [];
    for (const peerId of this.peers) {
      try {
        const response = await this.request(peerId, {
          protocol: 'apex.cas.v1',
          operation: 'object.put',
          namespace: this.namespace,
          hash,
          bytesBase64: bytes.toString('base64')
        });
        if (response.hash !== hash || response.bytes !== bytes.length || response.namespace !== this.namespace) {
          throw new Error('peer returned an invalid or cross-namespace durability receipt');
        }
        receipts.push({ peerId, hash, bytes: response.bytes, namespace: this.namespace, failureDomain: this.failureDomainsByPeerId[peerId] || null });
        const domains = new Set(receipts.map(receipt => receipt.failureDomain).filter(Boolean));
        if (receipts.length >= this.replicaCount && domains.size >= this.minFailureDomains) break;
      } catch (error) {
        failures.push({ peerId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    const verifiedFailureDomains = new Set(receipts.map(receipt => receipt.failureDomain).filter(Boolean)).size;
    if (receipts.length < this.replicaCount || verifiedFailureDomains < this.minFailureDomains) {
      const error = new Error('peer object write did not satisfy required replica count and independent failure-domain policy');
      error.code = 'INSUFFICIENT_REPLICAS';
      error.requiredReplicas = this.replicaCount;
      error.verifiedReplicas = receipts.length;
      error.requiredFailureDomains = this.minFailureDomains;
      error.verifiedFailureDomains = verifiedFailureDomains;
      error.failures = failures;
      throw error;
    }
    return {
      hash,
      bytes: bytes.length,
      namespace: this.namespace,
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
        const response = await this.request(peerId, {
          protocol: 'apex.cas.v1',
          operation: 'object.get',
          namespace: this.namespace,
          hash
        });
        const bytes = Buffer.from(String(response.bytesBase64 || ''), 'base64');
        if (sha256(bytes) !== hash || response.hash !== hash || response.namespace !== this.namespace) {
          throw new Error('peer returned content that failed SHA-256 or namespace verification');
        }
        return this.decrypt(JSON.parse(bytes.toString('utf8')));
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
 * Store holds only encrypted envelopes. Namespace authorization is mandatory.
 * The transport must invoke this only after authenticated peer allowlisting.
 */
export function createPeerObjectStorageHandler({
  store, peerId, authorizeNamespace, maxObjectBytes = 8 * 1024 * 1024
} = {}) {
  if (!store || typeof store.putObject !== 'function' || typeof store.getObject !== 'function') {
    throw new TypeError('a persistent content-addressed peer store is required');
  }
  if (!peerId) throw new TypeError('local peerId or peerId resolver is required');
  const resolvePeerId = () => String(typeof peerId === 'function' ? peerId() : peerId || '');
  if (typeof authorizeNamespace !== 'function') throw new TypeError('an explicit per-app namespace authorization policy is required');
  const limit = Number(maxObjectBytes);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('maxObjectBytes must be a positive integer');

  return async function handlePeerObjectStorage(envelope, { remotePeerId = '' } = {}) {
    if (!remotePeerId) throw new Error('authenticated remote peer identity missing');
    if (envelope?.protocol !== 'apex.cas.v1') return false;
    if (!validNamespace(envelope.namespace)) throw new Error('invalid peer storage namespace');
    const operation = String(envelope.operation || '');
    if (!['object.put', 'object.get'].includes(operation)) throw new Error('unsupported peer storage operation');
    if (await authorizeNamespace({ remotePeerId, namespace: envelope.namespace, operation }) !== true) {
      throw new Error('peer storage namespace access denied');
    }
    if (operation === 'object.put') {
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
      if (value?.namespace !== envelope.namespace || value?.algorithm !== 'aes-256-gcm' || value?.version !== 1) {
        throw new Error('peer object must be a correctly namespaced encrypted envelope');
      }
      const saved = await store.putObject(value);
      if (saved.hash !== envelope.hash || saved.bytes !== bytes.length) {
        throw new Error('persistent peer store did not preserve the requested object');
      }
      const localPeerId = resolvePeerId();
      if (!localPeerId) throw new Error('local peer identity is not ready');
      return { accepted: true, peerId: localPeerId, namespace: envelope.namespace, hash: saved.hash, bytes: saved.bytes };
    }
    if (!/^[a-f0-9]{64}$/.test(String(envelope.hash || ''))) throw new Error('invalid peer object read request');
    const value = await store.getObject(envelope.hash);
    const bytes = Buffer.from(canonical(value), 'utf8');
    if (sha256(bytes) !== envelope.hash || value?.namespace !== envelope.namespace ||
        value?.algorithm !== 'aes-256-gcm' || value?.version !== 1) {
      throw new Error('persistent peer object failed integrity or namespace verification');
    }
    const localPeerId = resolvePeerId();
    if (!localPeerId) throw new Error('local peer identity is not ready');
    return { accepted: true, peerId: localPeerId, namespace: envelope.namespace, hash: envelope.hash, bytesBase64: bytes.toString('base64') };
  };
}
