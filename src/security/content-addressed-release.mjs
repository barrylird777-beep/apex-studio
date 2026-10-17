import { createHash, sign, verify } from 'node:crypto';
import { encodeCanonical } from '../core/apex-cbor.mjs';

const HASH = /^[a-f0-9]{64}$/;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Buffer.from(encodeCanonical(value));
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function normalizeReleasePayload(input = {}) {
  if (!isRecord(input)) throw new TypeError('release payload must be an object');
  const sequence = Number(input.sequence);
  const version = String(input.version || '').trim();
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new TypeError('release sequence must be a positive safe integer');
  if (!/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,127}$/.test(version)) throw new TypeError('release version is invalid');
  if (!Array.isArray(input.artifacts) || input.artifacts.length < 1 || input.artifacts.length > 10000) throw new TypeError('release must include between 1 and 10000 artifact records');
  const seen = new Set();
  const artifacts = input.artifacts.map((artifact, index) => {
    if (!isRecord(artifact)) throw new TypeError('artifact ' + index + ' must be an object');
    const path = String(artifact.path || '');
    const hash = String(artifact.sha256 || '').toLowerCase();
    const sizeBytes = Number(artifact.sizeBytes);
    if (!path || path.length > 512 || path.startsWith('/') || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')) throw new TypeError('artifact path is unsafe');
    if (!HASH.test(hash)) throw new TypeError('artifact SHA-256 must be a lowercase 64-character hex digest');
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) throw new TypeError('artifact sizeBytes must be a nonnegative safe integer');
    if (seen.has(path)) throw new TypeError('release artifact paths must be unique');
    seen.add(path);
    return { path, sha256: hash, sizeBytes };
  }).sort((a, b) => a.path.localeCompare(b.path));
  const previousManifestHash = input.previousManifestHash == null ? null : String(input.previousManifestHash).toLowerCase();
  if (previousManifestHash !== null && !HASH.test(previousManifestHash)) throw new TypeError('previousManifestHash must be null or a SHA-256 digest');
  const createdAtMs = Date.parse(String(input.createdAt || ''));
  if (!Number.isFinite(createdAtMs)) throw new TypeError('release createdAt must be a valid timestamp');
  return { schemaVersion: 'apex.release.v1', sequence, version, previousManifestHash, createdAt: new Date(createdAtMs).toISOString(), artifacts };
}

export function signReleaseManifest(input, privateKey) {
  const payload = normalizeReleasePayload(input);
  const digest = sha256(canonical(payload));
  const signature = sign(null, Buffer.from(digest, 'hex'), privateKey).toString('base64');
  return Object.freeze({ payload: Object.freeze(payload), digest, signature });
}

export function verifyReleaseManifest(envelope, publicKey, { minimumSequence = 0, expectedPreviousHash } = {}) {
  if (!isRecord(envelope) || !isRecord(envelope.payload) || typeof envelope.signature !== 'string') throw new TypeError('release envelope is malformed');
  const payload = normalizeReleasePayload(envelope.payload);
  const digest = sha256(canonical(payload));
  if (digest !== envelope.digest || !verify(null, Buffer.from(digest, 'hex'), publicKey, Buffer.from(envelope.signature, 'base64'))) throw new Error('release digest or signature verification failed');
  if (payload.sequence <= Number(minimumSequence)) throw new Error('release sequence is stale; rollback must use a separately signed authorization');
  if (expectedPreviousHash !== undefined && payload.previousManifestHash !== expectedPreviousHash) throw new Error('release chain predecessor does not match the active manifest');
  return Object.freeze({ verified: true, digest, sequence: payload.sequence, version: payload.version, artifactCount: payload.artifacts.length });
}

export function signRollbackAuthorization(input, privateKey) {
  if (!isRecord(input)) throw new TypeError('rollback authorization must be an object');
  const sequence = Number(input.sequence);
  const currentManifestHash = String(input.currentManifestHash || '').toLowerCase();
  const targetManifestHash = String(input.targetManifestHash || '').toLowerCase();
  const reason = String(input.reason || '').trim();
  const createdAtMs = Date.parse(String(input.createdAt || ''));
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new TypeError('rollback sequence must be a positive safe integer');
  if (!HASH.test(currentManifestHash) || !HASH.test(targetManifestHash)) throw new TypeError('rollback hashes must be SHA-256 digests');
  if (reason.length < 10 || reason.length > 1000) throw new TypeError('rollback reason must contain 10–1000 characters');
  if (!Number.isFinite(createdAtMs)) throw new TypeError('rollback createdAt must be a valid timestamp');
  const payload = { schemaVersion: 'apex.rollback.v1', sequence, currentManifestHash, targetManifestHash, reason, createdAt: new Date(createdAtMs).toISOString() };
  const digest = sha256(canonical(payload));
  const signature = sign(null, Buffer.from(digest, 'hex'), privateKey).toString('base64');
  return Object.freeze({ payload: Object.freeze(payload), digest, signature });
}

export function verifyRollbackAuthorization(envelope, publicKey, { currentSequence, activeManifestHash, targetManifest, knownManifestHashes = [] } = {}) {
  if (!isRecord(envelope) || !isRecord(envelope.payload) || envelope.payload.schemaVersion !== 'apex.rollback.v1') throw new TypeError('rollback envelope is malformed');
  const payload = envelope.payload;
  const digest = sha256(canonical(payload));
  if (digest !== envelope.digest || !verify(null, Buffer.from(digest, 'hex'), publicKey, Buffer.from(String(envelope.signature || ''), 'base64'))) throw new Error('rollback digest or signature verification failed');
  if (!Number.isSafeInteger(currentSequence) || currentSequence < 0 ||
      !Number.isSafeInteger(payload.sequence) || payload.sequence < 1 || payload.sequence <= currentSequence) {
    throw new Error('rollback authorization sequence must advance monotonically');
  }
  if (!HASH.test(String(payload.currentManifestHash || '')) || !HASH.test(String(payload.targetManifestHash || '')) ||
      typeof payload.reason !== 'string' || payload.reason.trim().length < 10 || payload.reason.length > 1000 ||
      !Number.isFinite(Date.parse(String(payload.createdAt || ''))) ) {
    throw new TypeError('rollback authorization payload is invalid');
  }
  if (payload.currentManifestHash !== activeManifestHash) throw new Error('rollback authorization does not match the active manifest');
  if (!isRecord(targetManifest) || payload.targetManifestHash !== targetManifest.digest || !knownManifestHashes.includes(payload.targetManifestHash)) throw new Error('rollback target must be a known content-addressed release manifest');
  const target = verifyReleaseManifest(targetManifest, publicKey, { minimumSequence: 0 });
  return Object.freeze({ verified: true, sequence: Number(payload.sequence), targetManifestHash: payload.targetManifestHash, targetVersion: target.version });
}