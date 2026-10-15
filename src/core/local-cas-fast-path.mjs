import { createHash } from 'node:crypto';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const CID = /^[a-f0-9]{64}$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,511}$/;

/**
 * Volatile local CAS acceleration only. It is never a durable store or source
 * of truth. Public byte reads return defensive copies because Node Buffers are
 * mutable; callers cannot mutate the bytes held by this cache.
 */
export class LocalCasFastPath {
  constructor({ maxBytes = 8 * 1024 * 1024, ttlMs = 30_000, maxObjects = 4096, maxHeads = 4096, now = Date.now } = {}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new TypeError('maxBytes must be a nonnegative safe integer');
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) throw new TypeError('ttlMs must be a positive safe integer');
    if (!Number.isSafeInteger(maxObjects) || maxObjects < 1) throw new TypeError('maxObjects must be a positive safe integer');
    if (!Number.isSafeInteger(maxHeads) || maxHeads < 1) throw new TypeError('maxHeads must be a positive safe integer');
    if (typeof now !== 'function') throw new TypeError('now must be a function');
    this.maxBytes = maxBytes;
    this.ttlMs = ttlMs;
    this.maxObjects = maxObjects;
    this.maxHeads = maxHeads;
    this.now = now;
    this.objects = new Map();
    this.heads = new Map();
    this.objectBytes = 0;
  }

  putImmutable(input) {
    const bytes = Buffer.from(input);
    const cid = sha256(bytes);
    this.pruneExpired();
    const existing = this.objects.get(cid);
    if (existing) {
      if (!existing.bytes.equals(bytes)) {
        const error = new Error('content ID collision: stored immutable bytes differ');
        error.code = 'CID_COLLISION';
        throw error;
      }
      existing.expiresAt = this.now() + this.ttlMs;
      this.objects.delete(cid);
      this.objects.set(cid, existing);
      return { cid, bytes: bytes.length, cached: true };
    }
    if (this.maxBytes === 0 || bytes.length > this.maxBytes) {
      return { cid, bytes: bytes.length, cached: false };
    }
    this.objects.set(cid, { bytes, expiresAt: this.now() + this.ttlMs });
    this.objectBytes += bytes.length;
    while (this.objectBytes > this.maxBytes || this.objects.size > this.maxObjects) this.evictOldestObject();
    return { cid, bytes: bytes.length, cached: this.objects.has(cid) };
  }

  getImmutable(cid) {
    if (!CID.test(String(cid))) throw new TypeError('invalid immutable content ID');
    const entry = this.objects.get(cid);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.deleteObject(cid);
      return null;
    }
    this.objects.delete(cid);
    this.objects.set(cid, entry);
    return Buffer.from(entry.bytes);
  }

  readHead(key) {
    this.assertKey(key);
    const entry = this.heads.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now() || !this.objects.has(entry.cid)) {
      this.heads.delete(key);
      return null;
    }
    this.heads.delete(key);
    this.heads.set(key, entry);
    return entry.cid;
  }

  /**
   * Synchronous compare-and-swap. The comparison and pointer replacement run
   * in one JavaScript turn, so competing local callers cannot both win.
   * This is process-local only; it is not distributed or Byzantine CAS.
   */
  compareAndSwap(key, expectedCid, nextCid) {
    this.assertKey(key);
    if (expectedCid !== null && !CID.test(String(expectedCid))) throw new TypeError('invalid expected content ID');
    if (nextCid !== null && !CID.test(String(nextCid))) throw new TypeError('invalid next content ID');
    const current = this.readHead(key);
    if (current !== expectedCid) {
      const error = new Error('local CAS conflict');
      error.code = 'CAS_CONFLICT';
      error.expectedCid = expectedCid;
      error.currentCid = current;
      throw error;
    }
    if (nextCid === null) {
      this.heads.delete(key);
      return { previousCid: current, cid: null };
    }
    const object = this.objects.get(nextCid);
    if (!object || object.expiresAt <= this.now()) {
      const error = new Error('next immutable object is not available in the local fast path');
      error.code = 'OBJECT_UNAVAILABLE';
      throw error;
    }
    this.heads.delete(key);
    this.heads.set(key, { cid: nextCid, expiresAt: this.now() + this.ttlMs });
    while (this.heads.size > this.maxHeads) this.heads.delete(this.heads.keys().next().value);
    return { previousCid: current, cid: nextCid };
  }

  stats() {
    this.pruneExpired();
    return {
      objectCount: this.objects.size,
      objectBytes: this.objectBytes,
      headCount: this.heads.size,
      maxBytes: this.maxBytes,
      ttlMs: this.ttlMs,
      maxObjects: this.maxObjects,
      maxHeads: this.maxHeads
    };
  }

  clear() {
    this.objects.clear();
    this.heads.clear();
    this.objectBytes = 0;
  }

  assertKey(key) {
    if (typeof key !== 'string' || !KEY.test(key) || key.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new TypeError('invalid local CAS key');
    }
  }

  deleteObject(cid) {
    const entry = this.objects.get(cid);
    if (!entry) return false;
    this.objects.delete(cid);
    this.objectBytes -= entry.bytes.length;
    return true;
  }

  evictOldestObject() {
    const cid = this.objects.keys().next().value;
    if (cid !== undefined) this.deleteObject(cid);
  }

  pruneExpired() {
    const now = this.now();
    // All entries share one TTL and every hit refreshes/moves an entry to the
    // LRU tail, so expired objects are a prefix of this insertion-ordered Map.
    while (this.objects.size) {
      const oldest = this.objects.entries().next().value;
      if (!oldest || oldest[1].expiresAt > now) break;
      this.deleteObject(oldest[0]);
    }
    for (const [key, entry] of this.heads) {
      if (entry.expiresAt <= now || !this.objects.has(entry.cid)) this.heads.delete(key);
    }
  }
}

export default LocalCasFastPath;
