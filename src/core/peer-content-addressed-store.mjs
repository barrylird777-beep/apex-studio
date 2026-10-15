import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { decodeCanonical, encodeCanonical } from './apex-cbor.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const validNamespace = value => /^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(String(value || ''));
const hasVerifiedDurabilityReceipt = response =>
  response?.durable === true && response?.ownership === 'peer-owned' &&
  response?.recoveryVerified === true && response?.restartRecoveryVerified === true &&
  response?.atomicReferencesVerified === true && Boolean(response?.receipt) &&
  typeof response?.receiptId === 'string' && response.receiptId.length > 0;

/**
 * Peer-backed immutable object replication primitive.
 * Objects are AES-256-GCM encrypted before leaving the writer. Transport must
 * authenticate remote libp2p identities. There is no local-disk fallback.
 */
export class PeerContentAddressedStore {
  constructor({ transport, peers = [], replicaCount = 2, minFailureDomains = 1, failureDomainsByPeerId = {}, maxObjectBytes = 32 * 1024, namespace, encryptionKey, cacheTtlMs = 15000, cacheMaxBytes = 16 * 1024 * 1024 } = {}) {
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
    this.cacheTtlMs = Math.max(0, Number(cacheTtlMs) || 0);
    this.cacheMaxBytes = Math.max(0, Number(cacheMaxBytes) || 0);
    this.verifiedObjectCache = new Map();
    this.verifiedObjectCacheBytes = 0;
    this.cacheMetrics = { hits: 0, misses: 0, evictions: 0 };
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
    if (this.replicaCount > 1 || this.minFailureDomains > 1) {
      for (const peerId of this.peers) {
        if (!this.failureDomainsByPeerId[peerId]) throw new Error('every configured peer needs an explicit failure domain when multiple replicas are configured');
      }
      if (new Set(this.peers.map(peerId => this.failureDomainsByPeerId[peerId])).size < this.minFailureDomains) {
        throw new Error('insufficient configured failure domains for requested durability policy');
      }
    }
  }

  encrypt(value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    cipher.setAAD(Buffer.from(this.namespace, 'utf8'));
    const plaintext = encodeCanonical(value);
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
    decipher.setAAD(Buffer.from(this.namespace, 'utf8'));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decodeCanonical(plaintext);
  }

  async request(peerId, request) {
    const response = await this.transport.request(peerId, request);
    if (!response || response.peerId !== peerId || response.accepted !== true) {
      throw new Error('peer storage response identity or acceptance verification failed');
    }
    return response;
  }

  async putObject(value) {
    const bytes = encodeCanonical(this.encrypt(value));
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
        if (response.hash !== hash || response.bytes !== bytes.length || response.namespace !== this.namespace ||
            !hasVerifiedDurabilityReceipt(response)) {
          throw new Error('peer returned an invalid, cross-namespace, or unverified durability receipt');
        }
        receipts.push({
          peerId, hash, bytes: response.bytes, namespace: this.namespace,
          receiptId: response.receiptId, durabilityReceipt: response.receipt,
          failureDomain: this.failureDomainsByPeerId[peerId] || (this.minFailureDomains === 1 ? 'unspecified' : null)
        });
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

  async repairObject(hash, targetPeerIds = []) {
    if (!/^[a-f0-9]{64}$/.test(String(hash))) throw new Error('invalid SHA-256 object id');
    const targets = [...new Set(targetPeerIds.map(String).filter(Boolean))];
    if (targets.length === 0) throw new Error('at least one explicit repair target is required');
    for (const peerId of targets) {
      if (!this.peers.includes(peerId)) throw new Error('repair target is not in the configured peer allowlist');
    }

    let sourceBytes;
    let sourcePeerId = '';
    const sourceFailures = [];
    for (const peerId of this.peers) {
      if (targets.includes(peerId)) continue;
      try {
        const response = await this.request(peerId, {
          protocol: 'apex.cas.v1',
          operation: 'object.get',
          namespace: this.namespace,
          hash
        });
        const bytes = Buffer.from(String(response.bytesBase64 || ''), 'base64');
        if (response.hash !== hash || response.namespace !== this.namespace ||
            !hasVerifiedDurabilityReceipt(response) ||
            bytes.toString('base64') !== response.bytesBase64 || sha256(bytes) !== hash) {
          throw new Error('repair source failed object hash, namespace, or durability receipt verification');
        }
        const envelope = decodeCanonical(bytes);
        this.decrypt(envelope);
        sourceBytes = bytes;
        sourcePeerId = peerId;
        break;
      } catch (error) {
        sourceFailures.push({ peerId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (!sourceBytes) {
      const error = new Error('no healthy authorized peer could provide the object for repair');
      error.code = 'OBJECT_UNAVAILABLE';
      error.failures = sourceFailures;
      throw error;
    }

    const repaired = [];
    const failures = [];
    for (const peerId of targets) {
      try {
        const response = await this.request(peerId, {
          protocol: 'apex.cas.v1',
          operation: 'object.put',
          namespace: this.namespace,
          hash,
          bytesBase64: sourceBytes.toString('base64')
        });
        if (response.hash !== hash || response.bytes !== sourceBytes.length || response.namespace !== this.namespace ||
            !hasVerifiedDurabilityReceipt(response)) {
          throw new Error('repair target returned an invalid or unverified durability receipt');
        }
        repaired.push({ peerId, hash, bytes: response.bytes, namespace: this.namespace, failureDomain: this.failureDomainsByPeerId[peerId] || null });
      } catch (error) {
        failures.push({ peerId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (failures.length) {
      const error = new Error('object repair did not reach every requested target');
      error.code = 'REPAIR_INCOMPLETE';
      error.repaired = repaired;
      error.failures = failures;
      throw error;
    }
    return { hash, namespace: this.namespace, sourcePeerId, repaired };
  }

  async putBlob(input, { chunkSize = 8 * 1024 } = {}) {
    const blob = Buffer.from(input);
    const size = Number(chunkSize);
    if (!Number.isSafeInteger(size) || size < 1 || size > 8 * 1024) {
      throw new TypeError('chunkSize must be between 1 byte and 8 KiB for the current peer envelope ceiling');
    }
    const chunks = [];
    for (let offset = 0; offset < blob.length; offset += size) {
      const bytes = blob.subarray(offset, Math.min(offset + size, blob.length));
      const chunkHash = sha256(bytes);
      const receipt = await this.putObject({
        kind: 'apex.blob-chunk.v1',
        namespace: this.namespace,
        bytes: bytes.length,
        sha256: chunkHash,
        dataBase64: bytes.toString('base64')
      });
      chunks.push({ hash: receipt.hash, bytes: bytes.length, sha256: chunkHash });
    }
    const manifest = {
      kind: 'apex.blob-manifest.v1',
      version: 1,
      namespace: this.namespace,
      totalBytes: blob.length,
      sha256: sha256(blob),
      chunks
    };
    const receipt = await this.putObject(manifest);
    return { ...receipt, kind: manifest.kind, totalBytes: blob.length, contentSha256: manifest.sha256, chunkCount: chunks.length };
  }

  async getBlob(manifestHash) {
    const manifest = await this.getObject(manifestHash);
    if (!manifest || manifest.kind !== 'apex.blob-manifest.v1' || manifest.version !== 1 ||
        manifest.namespace !== this.namespace || !Number.isSafeInteger(manifest.totalBytes) ||
        manifest.totalBytes < 0 || !/^[a-f0-9]{64}$/.test(String(manifest.sha256 || '')) ||
        !Array.isArray(manifest.chunks)) {
      throw new Error('invalid or cross-namespace blob manifest');
    }
    if (manifest.chunks.some(item => !item || !/^[a-f0-9]{64}$/.test(String(item.hash || '')) ||
        !Number.isSafeInteger(item.bytes) || item.bytes < 1 ||
        !/^[a-f0-9]{64}$/.test(String(item.sha256 || '')))) {
      throw new Error('invalid blob chunk reference');
    }
    // Chunk fetches run concurrently; getObject races authorized peers and
    // verifies CID, app namespace, AEAD, and durability proof before returning.
    const configuredConcurrency = Number(process.env.APEX_PEER_CAS_FETCH_CONCURRENCY || 8);
    const concurrency = Math.max(1, Math.min(32, Number.isSafeInteger(configuredConcurrency) ? configuredConcurrency : 8));
    const parts = new Array(manifest.chunks.length);
    let nextIndex = 0;
    let total = 0;
    const worker = async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= manifest.chunks.length) return;
        const item = manifest.chunks[index];
        const chunk = await this.getObject(item.hash);
        if (!chunk || chunk.kind !== 'apex.blob-chunk.v1' || chunk.namespace !== this.namespace ||
            chunk.bytes !== item.bytes || chunk.sha256 !== item.sha256 || typeof chunk.dataBase64 !== 'string') {
          throw new Error('blob chunk metadata mismatch');
        }
        const bytes = Buffer.from(chunk.dataBase64, 'base64');
        if (bytes.toString('base64') !== chunk.dataBase64 || bytes.length !== item.bytes || sha256(bytes) !== item.sha256) {
          throw new Error('blob chunk integrity verification failed');
        }
        parts[index] = bytes;
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, manifest.chunks.length) }, worker));
    for (const part of parts) {
      if (!part) throw new Error('parallel asset assembly left a missing chunk');
      total += part.length;
      if (total > manifest.totalBytes) throw new Error('blob chunks exceed manifest length');
    }
    const blob = Buffer.concat(parts, total);
    if (total !== manifest.totalBytes || sha256(blob) !== manifest.sha256) {
      throw new Error('reconstructed blob failed total length or SHA-256 verification');
    }
    return blob;
  }

  cacheGet(hash) {
    const entry = this.verifiedObjectCache.get(hash);
    if (!entry) { this.cacheMetrics.misses++; return null; }
    if (entry.expiresAt <= Date.now()) {
      this.verifiedObjectCache.delete(hash);
      this.verifiedObjectCacheBytes -= entry.bytes.length;
      this.cacheMetrics.evictions++;
      this.cacheMetrics.misses++;
      return null;
    }
    // Refresh insertion order for bounded LRU eviction; payload stays RAM-only.
    this.verifiedObjectCache.delete(hash);
    this.verifiedObjectCache.set(hash, entry);
    this.cacheMetrics.hits++;
    return Buffer.from(entry.bytes);
  }

  cacheSet(hash, bytes) {
    if (!this.cacheTtlMs || !this.cacheMaxBytes || bytes.length > this.cacheMaxBytes) return;
    const prior = this.verifiedObjectCache.get(hash);
    if (prior) this.verifiedObjectCacheBytes -= prior.bytes.length;
    this.verifiedObjectCache.delete(hash);
    const copy = Buffer.from(bytes);
    this.verifiedObjectCache.set(hash, { bytes: copy, expiresAt: Date.now() + this.cacheTtlMs });
    this.verifiedObjectCacheBytes += copy.length;
    while (this.verifiedObjectCacheBytes > this.cacheMaxBytes && this.verifiedObjectCache.size) {
      const oldestKey = this.verifiedObjectCache.keys().next().value;
      const oldest = this.verifiedObjectCache.get(oldestKey);
      this.verifiedObjectCache.delete(oldestKey);
      this.verifiedObjectCacheBytes -= oldest.bytes.length;
      this.cacheMetrics.evictions++;
    }
  }

  cacheSnapshot() {
    return Object.freeze({ ...this.cacheMetrics, entries: this.verifiedObjectCache.size,
      bytes: this.verifiedObjectCacheBytes, ttlMs: this.cacheTtlMs, maxBytes: this.cacheMaxBytes });
  }

  async getObject(hash) {
    if (!/^[a-f0-9]{64}$/.test(String(hash))) throw new Error('invalid SHA-256 object id');
    const cached = this.cacheGet(hash);
    if (cached) return this.decrypt(decodeCanonical(cached));
    const failures = [];
    const attempts = this.peers.map(async peerId => {
      const response = await this.request(peerId, {
        protocol: 'apex.cas.v1', operation: 'object.get', namespace: this.namespace, hash
      });
      const encoded = String(response.bytesBase64 || '');
      const bytes = Buffer.from(encoded, 'base64');
      if (bytes.toString('base64') !== encoded || sha256(bytes) !== hash ||
          response.hash !== hash || response.namespace !== this.namespace ||
          !hasVerifiedDurabilityReceipt(response)) {
        throw new Error('peer returned content that failed integrity, namespace, or durability receipt verification');
      }
      // Authenticate the encrypted envelope before it can enter the RAM cache.
      const value = this.decrypt(decodeCanonical(bytes));
      return { bytes, value };
    });
    try {
      const verified = await Promise.any(attempts);
      this.cacheSet(hash, verified.bytes);
      return verified.value;
    } catch (aggregate) {
      for (const reason of aggregate?.errors || [aggregate]) {
        failures.push(reason instanceof Error ? reason.message : String(reason));
      }
    }
    const error = new Error('object was not recoverable from any configured peer');
    error.code = 'OBJECT_UNAVAILABLE';
    error.failures = failures;
    throw error;
  }

  async listRefs(namespace = this.namespace) {
    if (namespace !== this.namespace) throw new Error('peer reference listing cannot cross app namespaces');
    const byKey = new Map();
    const failures = [];
    let verifiedPeers = 0;
    let canonicalListing = null;
    for (const peerId of this.peers) {
      try {
        const response = await this.request(peerId, {
          protocol: 'apex.cas.v1', operation: 'ref.list', namespace
        });
        if (response.namespace !== namespace || !hasVerifiedDurabilityReceipt(response) || !Array.isArray(response.refs)) {
          throw new Error('peer reference listing lacks a verified durability receipt or valid reference list');
        }
        const peerKeys = new Set();
        const peerListing = new Map();
        for (const ref of response.refs) {
          if (!ref || typeof ref.key !== 'string' || !ref.key || ref.key.length > 512 ||
              !/^[a-f0-9]{64}$/.test(String(ref.hash || '')) || typeof ref.bytesBase64 !== 'string') {
            throw new Error('peer returned an invalid reference listing entry');
          }
          const bytes = Buffer.from(ref.bytesBase64, 'base64');
          if (bytes.toString('base64') !== ref.bytesBase64 || sha256(bytes) !== ref.hash || peerKeys.has(ref.key)) {
            throw new Error('peer reference listing failed integrity or duplicate-key verification');
          }
          peerKeys.add(ref.key);
          peerListing.set(ref.key, ref.hash);
          const value = decodeCanonical(bytes);
          const prior = byKey.get(ref.key);
          if (prior && prior.hash !== ref.hash) {
            const error = new Error('peer reference replicas disagree; refusing to select a potentially stale manifest');
            error.code = 'REFERENCE_DIVERGENCE';
            error.key = ref.key;
            throw error;
          }
          byKey.set(ref.key, { namespace, key: ref.key, hash: ref.hash, value });
        }
        if (canonicalListing === null) {
          canonicalListing = peerListing;
        } else if (canonicalListing.size !== peerListing.size ||
          [...canonicalListing].some(([key, hash]) => peerListing.get(key) !== hash)) {
          const error = new Error('peer reference listings differ in key coverage or hashes; refusing incomplete recovery state');
          error.code = 'REFERENCE_LISTING_DIVERGENCE';
          throw error;
        }
        verifiedPeers++;
      } catch (error) {
        if (error?.code === 'REFERENCE_DIVERGENCE' || error?.code === 'REFERENCE_LISTING_DIVERGENCE') throw error;
        failures.push({ peerId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (verifiedPeers < this.replicaCount) {
      const error = new Error('peer reference listing did not reach the configured verified replica count');
      error.code = 'INSUFFICIENT_REPLICAS';
      error.requiredReplicas = this.replicaCount;
      error.verifiedReplicas = verifiedPeers;
      error.failures = failures;
      throw error;
    }
    return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  async readRef(key) {
    if (typeof key !== 'string' || !key || key.length > 512) throw new TypeError('invalid peer reference key');
    const results = [];
    const failures = [];
    for (const peerId of this.peers) {
      try {
        const response = await this.request(peerId, {
          protocol: 'apex.cas.v1', operation: 'ref.get',
          namespace: this.namespace, key
        });
        if (response.namespace !== this.namespace || !hasVerifiedDurabilityReceipt(response)) {
          throw new Error('peer reference read failed namespace or durability receipt verification');
        }
        if (response.hash === null) {
          results.push({ peerId, hash: null, value: null });
          continue;
        }
        const bytes = Buffer.from(String(response.bytesBase64 || ''), 'base64');
        if (!/^[a-f0-9]{64}$/.test(String(response.hash || '')) ||
            bytes.toString('base64') !== response.bytesBase64 || sha256(bytes) !== response.hash) {
          throw new Error('peer reference content failed hash verification');
        }
        results.push({ peerId, hash: response.hash, value: decodeCanonical(bytes) });
      } catch (error) {
        failures.push({ peerId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (results.length === 0) {
      const error = new Error('peer reference was not recoverable from any verified peer');
      error.code = 'OBJECT_UNAVAILABLE';
      error.failures = failures;
      throw error;
    }
    const hashes = new Set(results.map(result => result.hash));
    if (hashes.size !== 1) {
      const error = new Error('peer reference replicas disagree; refusing to select a potentially stale manifest');
      error.code = 'REFERENCE_DIVERGENCE';
      error.hashes = results.map(result => ({ peerId: result.peerId, hash: result.hash }));
      throw error;
    }
    const first = results[0];
    return first.hash === null ? null : { value: first.value, hash: first.hash };
  }

  async writeRef(key, value, { expectedHash = null } = {}) {
    if (typeof key !== 'string' || !key || key.length > 512) throw new TypeError('invalid peer reference key');
    if (expectedHash !== null && !/^[a-f0-9]{64}$/.test(String(expectedHash))) {
      throw new TypeError('invalid expected peer reference hash');
    }
    const bytes = encodeCanonical(value);
    if (bytes.length > this.maxObjectBytes) throw new Error('peer reference exceeds the safe single-envelope limit');
    const hash = sha256(bytes);
    const receipts = [];
    const failures = [];
    for (const peerId of this.peers) {
      try {
        const response = await this.request(peerId, {
          protocol: 'apex.cas.v1', operation: 'ref.cas',
          namespace: this.namespace, key, expectedHash, hash,
          bytesBase64: bytes.toString('base64')
        });
        if (response.code === 'CAS_CONFLICT' || response.conflict === true) {
          const error = new Error('peer reference changed before the atomic update');
          error.code = 'CAS_CONFLICT';
          error.peerId = peerId;
          error.currentHash = response.hash ?? null;
          throw error;
        }
        if (response.namespace !== this.namespace || response.hash !== hash ||
            !hasVerifiedDurabilityReceipt(response)) {
          throw new Error('peer reference write failed hash, namespace, or durability receipt verification');
        }
        receipts.push({
          peerId, hash, receiptId: response.receiptId,
          failureDomain: this.failureDomainsByPeerId[peerId] || (this.minFailureDomains === 1 ? 'unspecified' : null)
        });
        const domains = new Set(receipts.map(receipt => receipt.failureDomain).filter(Boolean));
        if (receipts.length >= this.replicaCount && domains.size >= this.minFailureDomains) break;
      } catch (error) {
        if (error?.code === 'CAS_CONFLICT') throw error;
        failures.push({ peerId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    const verifiedFailureDomains = new Set(receipts.map(receipt => receipt.failureDomain).filter(Boolean)).size;
    if (receipts.length < this.replicaCount || verifiedFailureDomains < this.minFailureDomains) {
      const error = new Error('peer reference update did not satisfy required replica count and independent failure-domain policy');
      error.code = 'INSUFFICIENT_REPLICAS';
      error.requiredReplicas = this.replicaCount;
      error.verifiedReplicas = receipts.length;
      error.failures = failures;
      throw error;
    }
    return { hash, replicas: receipts.map(receipt => receipt.peerId), receipts };
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
  if (!store || typeof store.putBytes !== 'function' || typeof store.getBytes !== 'function') {
    throw new TypeError('a peer-owned binary object backend with putBytes(hash, bytes) and getBytes(hash) is required');
  }
  if (!peerId) throw new TypeError('local peerId or peerId resolver is required');
  const resolvePeerId = () => String(typeof peerId === 'function' ? peerId() : peerId || '');
  if (typeof authorizeNamespace !== 'function') throw new TypeError('an explicit per-app namespace authorization policy is required');
  const limit = Number(maxObjectBytes);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('maxObjectBytes must be a positive integer');
  const hasReferenceBackend = typeof store.readRef === 'function' && typeof store.writeRef === 'function';
  const capacityReceipt = async (namespace, expectedPeerId) => {
    if (!hasReferenceBackend || typeof store.health !== 'function' ||
        typeof store.verifyDurabilityReceipt !== 'function') {
      return { durable: false, ownership: 'unverified', recoveryVerified: false, restartRecoveryVerified: false, atomicReferencesVerified: false };
    }
    const proof = await store.health({ namespace, peerId: expectedPeerId });
    const verified = proof?.durable === true && proof?.ownership === 'peer-owned'
      && proof?.restartRecoveryVerified === true && proof?.atomicReferencesVerified === true
      && proof?.peerId === expectedPeerId && proof?.namespace === namespace
      && proof?.receipt && await store.verifyDurabilityReceipt(proof.receipt, {
        namespace, peerId: expectedPeerId, restartRecoveryVerified: true, atomicReferencesVerified: true
      }) === true;
    return {
      durable: verified,
      ownership: verified ? 'peer-owned' : 'unverified',
      recoveryVerified: verified,
      restartRecoveryVerified: verified,
      atomicReferencesVerified: verified,
      ...(verified ? {
        receipt: proof.receipt,
        ...(typeof proof.receiptId === 'string' && proof.receiptId ? { receiptId: proof.receiptId } : {})
      } : {})
    };
  };
  const validHash = value => /^[a-f0-9]{64}$/.test(String(value || ''));

  return async function handlePeerObjectStorage(envelope, { remotePeerId = '' } = {}) {
    if (!remotePeerId) throw new Error('authenticated remote peer identity missing');
    if (envelope?.protocol !== 'apex.cas.v1') return false;
    if (!validNamespace(envelope.namespace)) throw new Error('invalid peer storage namespace');
    const operation = String(envelope.operation || '');
    if (!['storage.health', 'object.put', 'object.get', 'ref.get', 'ref.cas', 'ref.list'].includes(operation)) {
      throw new Error('unsupported peer storage operation');
    }
    if (await authorizeNamespace({ remotePeerId, namespace: envelope.namespace, operation }) !== true) {
      throw new Error('peer storage namespace access denied');
    }
    const localPeerId = resolvePeerId();
    if (!localPeerId) throw new Error('local peer identity is not ready');

    if (operation === 'storage.health') {
      return { accepted: true, peerId: localPeerId, namespace: envelope.namespace, ...await capacityReceipt(envelope.namespace, localPeerId) };
    }

    if (operation === 'object.put') {
      if (typeof envelope.bytesBase64 !== 'string' || !validHash(envelope.hash)) {
        throw new Error('invalid peer object write request');
      }
      const bytes = Buffer.from(envelope.bytesBase64, 'base64');
      if (bytes.length > limit || bytes.toString('base64') !== envelope.bytesBase64) {
        throw new Error('peer object write exceeds size limit or is not canonical base64');
      }
      if (sha256(bytes) !== envelope.hash) throw new Error('peer object write hash mismatch');
      let value;
      try { value = decodeCanonical(bytes); }
      catch { throw new Error('peer object payload is not a valid CBOR envelope'); }
      if (value?.namespace !== envelope.namespace || value?.algorithm !== 'aes-256-gcm' || value?.version !== 1) {
        throw new Error('peer object must be a correctly namespaced encrypted envelope');
      }
      const saved = await store.putBytes(envelope.hash, bytes);
      if (saved.hash !== envelope.hash || saved.bytes !== bytes.length) {
        throw new Error('persistent peer store did not preserve the requested object');
      }
      return { accepted: true, peerId: localPeerId, namespace: envelope.namespace, hash: saved.hash, bytes: saved.bytes, ...await capacityReceipt(envelope.namespace, localPeerId) };
    }

    if (operation === 'object.get') {
      if (!validHash(envelope.hash)) throw new Error('invalid peer object read request');
      const bytes = Buffer.from(await store.getBytes(envelope.hash));
      let value;
      try { value = decodeCanonical(bytes); } catch { throw new Error('persistent peer object is not valid canonical CBOR'); }
      if (sha256(bytes) !== envelope.hash || value?.namespace !== envelope.namespace ||
          value?.algorithm !== 'aes-256-gcm' || value?.version !== 1) {
        throw new Error('persistent peer object failed integrity or namespace verification');
      }
      return { accepted: true, peerId: localPeerId, namespace: envelope.namespace, hash: envelope.hash, bytesBase64: bytes.toString('base64'), ...await capacityReceipt(envelope.namespace, localPeerId) };
    }

    const capacity = await capacityReceipt(envelope.namespace, localPeerId);
    if (capacity.durable !== true || capacity.ownership !== 'peer-owned') {
      throw new Error('peer reference operations require verified durable peer-owned storage with restart recovery');
    }
    if (operation === 'ref.list') {
      if (typeof store.listRefs !== 'function') throw new Error('peer reference listing is unsupported by this durable backend');
      const refs = await store.listRefs(envelope.namespace);
      const listed = refs.map(ref => {
        const bytes = Buffer.from(ref.bytes);
        if (typeof ref.key !== 'string' || !ref.key || ref.key.length > 512 ||
            !validHash(ref.hash) || sha256(bytes) !== ref.hash) {
          throw new Error('peer reference listing failed key, hash, or byte integrity verification');
        }
        return { key: ref.key, hash: ref.hash, bytesBase64: bytes.toString('base64') };
      });
      return { accepted: true, peerId: localPeerId, namespace: envelope.namespace, refs: listed, ...capacity };
    }

    if (typeof envelope.key !== 'string' || !envelope.key || envelope.key.length > 512) {
      throw new Error('invalid peer reference key');
    }
    if (operation === 'ref.get') {
      const current = await store.readRef(envelope.namespace, envelope.key);
      if (current == null) return { accepted: true, peerId: localPeerId, namespace: envelope.namespace, hash: null, ...capacity };
      const bytes = Buffer.from(current.bytes);
      if (!validHash(current.hash) || sha256(bytes) !== current.hash) {
        throw new Error('peer reference failed integrity verification');
      }
      return { accepted: true, peerId: localPeerId, namespace: envelope.namespace, hash: current.hash, bytesBase64: bytes.toString('base64'), ...capacity };
    }

    if (envelope.expectedHash !== null && !validHash(envelope.expectedHash)) {
      throw new Error('invalid expected peer reference hash');
    }
    if (!validHash(envelope.hash) || typeof envelope.bytesBase64 !== 'string') {
      throw new Error('invalid peer reference write request');
    }
    const bytes = Buffer.from(envelope.bytesBase64, 'base64');
    if (bytes.length > limit || bytes.toString('base64') !== envelope.bytesBase64 || sha256(bytes) !== envelope.hash) {
      throw new Error('peer reference write failed size, encoding, or hash verification');
    }
    let saved;
    try {
      saved = await store.writeRef(envelope.namespace, envelope.key, envelope.expectedHash ?? null, envelope.hash, bytes);
    } catch (error) {
      if (error?.code === 'CAS_CONFLICT' || error?.code === 'REFERENCE_CONFLICT') {
        const current = typeof store.readRef === 'function'
          ? await store.readRef(envelope.namespace, envelope.key)
          : null;
        return { accepted: true, peerId: localPeerId, namespace: envelope.namespace,
          code: 'CAS_CONFLICT', conflict: true, hash: current?.hash ?? null, ...capacity };
      }
      throw error;
    }
    if (!saved || saved.hash !== envelope.hash) throw new Error('peer reference backend did not confirm atomic reference update');
    return { accepted: true, peerId: localPeerId, namespace: envelope.namespace, hash: saved.hash, ...capacity };
  };
}
