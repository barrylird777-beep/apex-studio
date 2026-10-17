import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { decodeCanonical, encodeCanonical } from './apex-cbor.mjs';
import { LocalCasFastPath } from './local-cas-fast-path.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const validNamespace = value => /^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(String(value || ''));
async function mapConcurrent(items, limit, mapper) {
  const output = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(items.length, Math.max(1, limit)) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      output[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return output;
}

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
  constructor({ transport, peers = [], replicaCount = 2, minFailureDomains = null, failureDomainsByPeerId = {}, maxObjectBytes = 32 * 1024, memoryCacheBytes = 8 * 1024 * 1024, memoryCacheTtlMs = 30000, namespace, encryptionKey } = {}) {
    if (!transport || typeof transport.request !== 'function') {
      throw new TypeError('PeerContentAddressedStore requires an authenticated transport.request(peerId, request)');
    }
    if (!validNamespace(namespace)) throw new TypeError('a valid per-app namespace is required');
    const key = typeof encryptionKey === 'string' ? Buffer.from(encryptionKey, 'base64') : Buffer.from(encryptionKey || []);
    if (key.length !== 32) throw new TypeError('encryptionKey must be a 32-byte AES-256 key');
    this.transport = transport;
    this.peers = [...new Set(peers.map(String).filter(Boolean))];
    this.replicaCount = Number(replicaCount);
    this.minFailureDomains = minFailureDomains == null ? this.replicaCount : Number(minFailureDomains);
    this.failureDomainsByPeerId = Object.fromEntries(Object.entries(failureDomainsByPeerId || {}).map(([id, domain]) => [String(id), String(domain || '').trim()]));
    this.namespace = namespace;
    this.encryptionKey = key;
    this.maxObjectBytes = Number(maxObjectBytes);
    this.memoryCacheBytes = Number(memoryCacheBytes);
    this.memoryCacheTtlMs = Number(memoryCacheTtlMs);
    if (!Number.isSafeInteger(this.memoryCacheBytes) || this.memoryCacheBytes < 0 ||
        !Number.isSafeInteger(this.memoryCacheTtlMs) || this.memoryCacheTtlMs < 1) {
      throw new TypeError('memory cache requires a nonnegative byte budget and positive TTL');
    }
    this.localFastPath = new LocalCasFastPath({ maxBytes: this.memoryCacheBytes, ttlMs: this.memoryCacheTtlMs, maxHeads: 4096 });
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
    if (this.replicaCount > 1 && this.minFailureDomains !== this.replicaCount) {
      throw new Error('below-zero-trust storage policy requires every replica to occupy a distinct configured failure domain');
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

  cacheVerifiedObject(hash, value) {
    if (this.memoryCacheBytes === 0) return;
    const stored = this.localFastPath.putImmutable(encodeCanonical(value));
    if (!stored.cached) return;
    const current = this.localFastPath.readHead(hash);
    this.localFastPath.compareAndSwap(hash, current, stored.cid);
  }

  readVerifiedMemoryCache(hash) {
    const cid = this.localFastPath.readHead(hash);
    if (!cid) return null;
    const bytes = this.localFastPath.getImmutable(cid);
    return bytes === null ? null : decodeCanonical(bytes);
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
        const errorMessage = error instanceof Error ? error.message : '';
        const failure = errorMessage === 'peer returned an invalid, cross-namespace, or unverified durability receipt'
          ? 'unverified durability receipt'
          : 'Peer object write failed';
        failures.push({ peerId, error: failure });
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
        sourceFailures.push({ peerId, error: 'Peer source unavailable' });
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
        failures.push({ peerId, error: 'Peer repair failed' });
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

  async repairRef(key, targetPeerIds = []) {
    if (typeof key !== 'string' || !key || key.length > 512) throw new TypeError('invalid peer reference key');
    const targets = [...new Set(targetPeerIds.map(String).filter(Boolean))];
    if (targets.length === 0) throw new Error('at least one explicit reference repair target is required');
    for (const peerId of targets) {
      if (!this.peers.includes(peerId)) throw new Error('reference repair target is not in the configured peer allowlist');
    }

    let source;
    const sourceFailures = [];
    for (const peerId of this.peers) {
      if (targets.includes(peerId)) continue;
      try {
        const response = await this.request(peerId, {
          protocol: 'apex.cas.v1', operation: 'ref.get',
          namespace: this.namespace, key
        });
        if (response.namespace !== this.namespace || !hasVerifiedDurabilityReceipt(response)) {
          throw new Error('reference repair source failed namespace or durability receipt verification');
        }
        if (response.hash === null) continue;
        const bytes = Buffer.from(String(response.bytesBase64 || ''), 'base64');
        if (!/^[a-f0-9]{64}$/.test(String(response.hash || '')) ||
            bytes.toString('base64') !== response.bytesBase64 || sha256(bytes) !== response.hash) {
          throw new Error('reference repair source failed hash verification');
        }
        decodeCanonical(bytes);
        source = { peerId, hash: response.hash, bytes };
        break;
      } catch (error) {
        sourceFailures.push({ peerId, error: 'Peer source unavailable' });
      }
    }
    if (!source) {
      const error = new Error('no healthy authorized peer could provide the reference for repair');
      error.code = 'REFERENCE_UNAVAILABLE';
      error.failures = sourceFailures;
      throw error;
    }

    const repaired = [];
    const failures = [];
    for (const peerId of targets) {
      try {
        const current = await this.request(peerId, {
          protocol: 'apex.cas.v1', operation: 'ref.get',
          namespace: this.namespace, key
        });
        if (current.namespace !== this.namespace || !hasVerifiedDurabilityReceipt(current)) {
          throw new Error('reference repair target failed namespace or durability receipt verification');
        }
        if (current.hash !== null) {
          const currentBytes = Buffer.from(String(current.bytesBase64 || ''), 'base64');
          if (!/^[a-f0-9]{64}$/.test(String(current.hash || '')) ||
              currentBytes.toString('base64') !== current.bytesBase64 || sha256(currentBytes) !== current.hash) {
            throw new Error('reference repair target failed hash verification');
          }
          decodeCanonical(currentBytes);
        }
        if (current.hash === source.hash) {
          repaired.push({ peerId, hash: source.hash, alreadyPresent: true });
          continue;
        }
        if (current.hash !== null) {
          const error = new Error('reference repair target contains a different value; refusing destructive overwrite');
          error.code = 'REFERENCE_DIVERGENCE';
          throw error;
        }
        const response = await this.request(peerId, {
          protocol: 'apex.cas.v1', operation: 'ref.cas',
          namespace: this.namespace, key, expectedHash: null,
          hash: source.hash, bytesBase64: source.bytes.toString('base64')
        });
        if (response.namespace !== this.namespace || response.hash !== source.hash ||
            !hasVerifiedDurabilityReceipt(response)) {
          throw new Error('reference repair target returned an invalid durability receipt');
        }
        repaired.push({ peerId, hash: source.hash, alreadyPresent: false, receiptId: response.receiptId });
      } catch (error) {
        failures.push({ peerId, error: 'Peer repair failed' });
      }
    }
    if (failures.length) {
      const error = new Error('reference repair did not reach every requested target');
      error.code = 'REFERENCE_REPAIR_INCOMPLETE';
      error.repaired = repaired;
      error.failures = failures;
      throw error;
    }
    return { key, hash: source.hash, namespace: this.namespace, sourcePeerId: source.peerId, repaired };
  }

  async putBlob(input, { chunkSize = 8 * 1024, manifestFanout = 96 } = {}) {
    const blob = Buffer.from(input);
    const size = Number(chunkSize);
    const fanout = Number(manifestFanout);
    if (!Number.isSafeInteger(size) || size < 1 || size > 8 * 1024) {
      throw new TypeError('chunkSize must be between 1 byte and 8 KiB for the current peer envelope ceiling');
    }
    if (!Number.isSafeInteger(fanout) || fanout < 2 || fanout > 96) {
      throw new TypeError('manifestFanout must be between 2 and 96 to keep encrypted manifests below the peer envelope ceiling');
    }
    const digest = sha256(blob);
    const leaves = [];
    let offset = 0;
    let leafChunks = [];
    let leafBytes = 0;
    const flushLeaf = async () => {
      if (!leafChunks.length) return;
      const leaf = {
        kind: 'apex.blob-manifest.v1', version: 1, namespace: this.namespace,
        totalBytes: leafBytes,
        sha256: sha256(blob.subarray(offset - leafBytes, offset)),
        chunks: leafChunks
      };
      const saved = await this.putObject(leaf);
      leaves.push({ hash: saved.hash, bytes: leaf.totalBytes, sha256: leaf.sha256, start: offset - leafBytes, end: offset });
      leafChunks = [];
      leafBytes = 0;
    };

    while (offset < blob.length) {
      const bytes = blob.subarray(offset, Math.min(offset + size, blob.length));
      const chunkHash = sha256(bytes);
      const receipt = await this.putObject({
        kind: 'apex.blob-chunk.v1', namespace: this.namespace,
        bytes: bytes.length, sha256: chunkHash, dataBase64: bytes.toString('base64')
      });
      leafChunks.push({ hash: receipt.hash, bytes: bytes.length, sha256: chunkHash });
      leafBytes += bytes.length;
      offset += bytes.length;
      if (leafChunks.length >= fanout) await flushLeaf();
    }
    await flushLeaf();

    let level = leaves;
    let depth = 0;
    while (level.length > 1) {
      depth += 1;
      if (depth > 16) throw new Error('blob manifest tree exceeds maximum depth');
      const nextLevel = [];
      for (let index = 0; index < level.length; index += fanout) {
        const children = level.slice(index, index + fanout);
        const start = children[0].start;
        const end = children[children.length - 1].end;
        const totalBytes = end - start;
        const subtreeDigest = sha256(blob.subarray(start, end));
        const node = {
          kind: 'apex.blob-tree.v1', version: 1, namespace: this.namespace,
          totalBytes, sha256: subtreeDigest,
          children: children.map(({ hash, bytes, sha256: childSha256 }) => ({ hash, bytes, sha256: childSha256 }))
        };
        const saved = await this.putObject(node);
        nextLevel.push({ hash: saved.hash, bytes: totalBytes, sha256: subtreeDigest, start, end });
      }
      level = nextLevel;
    }

    if (!level.length) {
      const empty = await this.putObject({
        kind: 'apex.blob-manifest.v1', version: 1, namespace: this.namespace,
        totalBytes: 0, sha256: digest, chunks: []
      });
      return { ...empty, kind: 'apex.blob-manifest.v1', totalBytes: 0, contentSha256: digest, chunkCount: 0 };
    }
    const root = await this.getObject(level[0].hash);
    if (root.sha256 !== digest || root.totalBytes !== blob.length) {
      throw new Error('peer blob manifest root failed source length or digest verification');
    }
    return {
      hash: level[0].hash,
      bytes: level[0].bytes,
      namespace: this.namespace,
      uri: 'cas://sha256/' + level[0].hash,
      replicas: [],
      receipts: [],
      kind: root.kind,
      totalBytes: blob.length,
      contentSha256: digest,
      chunkCount: Math.ceil(blob.length / size)
    };
  }

  async getBlob(manifestHash) {
    const MAX_CHUNKS = 131072;
    const MAX_DEPTH = 16;
    let seenChunks = 0;
    async function readNode(store, hash, depth = 0) {
      if (depth > MAX_DEPTH) throw new Error('blob manifest tree exceeds maximum depth');
      const node = await store.getObject(hash);
      if (!node || node.namespace !== store.namespace || node.version !== 1 ||
          !Number.isSafeInteger(node.totalBytes) || node.totalBytes < 0 ||
          !/^[a-f0-9]{64}$/.test(String(node.sha256 || ''))) {
        throw new Error('invalid or cross-namespace blob manifest');
      }
      if (node.kind === 'apex.blob-manifest.v1') {
        if (!Array.isArray(node.chunks)) throw new Error('invalid blob leaf manifest');
        const parts = await mapConcurrent(node.chunks, 8, async item => {
          seenChunks += 1;
          if (seenChunks > MAX_CHUNKS || !item || !/^[a-f0-9]{64}$/.test(String(item.hash || '')) ||
              !Number.isSafeInteger(item.bytes) || item.bytes < 1 ||
              !/^[a-f0-9]{64}$/.test(String(item.sha256 || ''))) {
            throw new Error('invalid or oversized blob chunk reference');
          }
          const chunk = await store.getObject(item.hash);
          if (!chunk || chunk.kind !== 'apex.blob-chunk.v1' || chunk.namespace !== store.namespace ||
              chunk.bytes !== item.bytes || chunk.sha256 !== item.sha256 || typeof chunk.dataBase64 !== 'string') {
            throw new Error('blob chunk metadata mismatch');
          }
          const bytes = Buffer.from(chunk.dataBase64, 'base64');
          if (bytes.toString('base64') !== chunk.dataBase64 || bytes.length !== item.bytes || sha256(bytes) !== item.sha256) {
            throw new Error('blob chunk integrity verification failed');
          }
          return bytes;
        });
        const bytes = Buffer.concat(parts);
        if (bytes.length !== node.totalBytes || sha256(bytes) !== node.sha256) {
          throw new Error('blob leaf failed total length or SHA-256 verification');
        }
        return bytes;
      }
      if (node.kind !== 'apex.blob-tree.v1' || !Array.isArray(node.children) ||
          node.children.length < 2 || node.children.length > 96) {
        throw new Error('invalid blob tree node');
      }
      const parts = await mapConcurrent(node.children, 8, async child => {
        if (!child || !/^[a-f0-9]{64}$/.test(String(child.hash || '')) ||
            !Number.isSafeInteger(child.bytes) || child.bytes < 1 ||
            !/^[a-f0-9]{64}$/.test(String(child.sha256 || ''))) {
          throw new Error('invalid blob tree child reference');
        }
        const bytes = await readNode(store, child.hash, depth + 1);
        if (bytes.length !== child.bytes || sha256(bytes) !== child.sha256) {
          throw new Error('blob tree child failed length or digest verification');
        }
        return bytes;
      });
      const bytes = Buffer.concat(parts);
      if (bytes.length !== node.totalBytes || sha256(bytes) !== node.sha256) {
        throw new Error('blob tree failed total length or SHA-256 verification');
      }
      return bytes;
    }
    return readNode(this, manifestHash);
  }

  async getObject(hash) {
    if (!/^[a-f0-9]{64}$/.test(String(hash))) throw new Error('invalid SHA-256 object id');
    const cached = this.readVerifiedMemoryCache(hash);
    if (cached !== null) return cached;
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
        if (bytes.toString('base64') !== response.bytesBase64 || sha256(bytes) !== hash ||
            response.hash !== hash || response.namespace !== this.namespace ||
            !hasVerifiedDurabilityReceipt(response)) {
          throw new Error('peer returned content that failed integrity, namespace, or durability receipt verification');
        }
        const value = this.decrypt(decodeCanonical(bytes));
        this.cacheVerifiedObject(hash, value);
        return value;
      } catch (error) {
        failures.push('Peer repair failed');
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
        failures.push({ peerId, error: 'Peer repair failed' });
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
        failures.push({ peerId, error: 'Peer repair failed' });
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
        failures.push({ peerId, error: 'Peer repair failed' });
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
    const saved = await store.writeRef(envelope.namespace, envelope.key, envelope.expectedHash ?? null, envelope.hash, bytes);
    if (!saved || saved.hash !== envelope.hash) throw new Error('peer reference backend did not confirm atomic reference update');
    return { accepted: true, peerId: localPeerId, namespace: envelope.namespace, hash: saved.hash, ...capacity };
  };
}
