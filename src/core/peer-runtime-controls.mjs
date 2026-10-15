import { createHash, sign as cryptoSign, verify as cryptoVerify, randomUUID } from 'node:crypto';
import { encodeCanonical } from './apex-cbor.mjs';

const APPS = new Set(['KernelVision', 'XShield', 'Kernelodies', 'PlanetApeX', 'KashKorner', 'KoinKob']);
const ACTIONS = new Set(['read', 'write', 'delete', 'claim', 'publish', 'delegate']);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const canonicalBytes = value => encodeCanonical(value);
const cidFor = value => sha256(canonicalBytes(value));
const safePath = value => typeof value === 'string' && value.length > 0 &&
  value.length <= 512 && !value.startsWith('/') && !value.split('/').some(part => !part || part === '.' || part === '..');

function stableRules(rules) {
  if (!Array.isArray(rules) || rules.length > 4096) throw new TypeError('access tensor rules must be a bounded array');
  return rules.map(rule => {
    if (!rule || !APPS.has(rule.app) || !ACTIONS.has(rule.action) || !safePath(rule.path)) {
      throw new TypeError('invalid access tensor rule');
    }
    return Object.freeze({ app: rule.app, action: rule.action, path: rule.path,
      allow: rule.allow === true });
  }).sort((a, b) => a.app.localeCompare(b.app) || a.path.localeCompare(b.path) ||
    a.action.localeCompare(b.action) || Number(a.allow) - Number(b.allow));
}

export function createAccessTensor({ version = 1, rules = [], quotas = {} } = {}) {
  if (version !== 1) throw new TypeError('unsupported access tensor version');
  const normalized = stableRules(rules);
  const seen = new Set();
  for (const rule of normalized) {
    const key = rule.app + '\\0' + rule.action + '\\0' + rule.path;
    if (seen.has(key)) throw new TypeError('duplicate access tensor rule');
    seen.add(key);
  }
  const boundedQuotas = Object.create(null);
  for (const app of [...APPS].sort()) {
    const quota = quotas[app] || {};
    const normalizedQuota = {};
    for (const key of ['maxConcurrentJobs', 'maxCpuMs', 'maxMemoryBytes', 'maxStorageBytes']) {
      const value = quota[key];
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
        throw new TypeError('access tensor quotas must be non-negative safe integers');
      }
      if (value !== undefined) normalizedQuota[key] = value;
    }
    boundedQuotas[app] = Object.freeze(normalizedQuota);
  }
  const tensor = Object.freeze({ kind: 'apex.access-tensor.v1', version, rules: normalized, quotas: Object.freeze(boundedQuotas) });
  return Object.freeze({ tensor, cid: cidFor(tensor) });
}

export function evaluateAccessTensor(tensor, { app, action, path, usage = {} } = {}) {
  if (!tensor || tensor.kind !== 'apex.access-tensor.v1' || tensor.version !== 1 ||
      !APPS.has(app) || !ACTIONS.has(action) || !safePath(path)) return Object.freeze({ allowed: false, reason: 'invalid-request' });
  // Most-specific path rule wins. Deny is the default; wildcard matching is intentionally absent.
  const matches = tensor.rules.filter(rule => rule.app === app && rule.action === action &&
    (path === rule.path || path.startsWith(rule.path + '/')))
    .sort((a, b) => b.path.length - a.path.length);
  if (!matches.length || matches[0].allow !== true) return Object.freeze({ allowed: false, reason: 'tensor-deny' });
  const quota = tensor.quotas?.[app] || {};
  const checks = [
    ['maxConcurrentJobs', 'concurrentJobs'],
    ['maxCpuMs', 'cpuMs'],
    ['maxMemoryBytes', 'memoryBytes'],
    ['maxStorageBytes', 'storageBytes']
  ];
  for (const [limitKey, usageKey] of checks) {
    if (quota[limitKey] !== undefined && Number(usage[usageKey] || 0) > quota[limitKey]) {
      return Object.freeze({ allowed: false, reason: 'quota-exceeded', quota: limitKey });
    }
  }
  return Object.freeze({ allowed: true, reason: 'tensor-allow' });
}

/** Publish immutable tensor content first, then atomically swap the current-version pointer. */
export async function publishAccessTensor({ cas, tensor, expectedHash = null, pointerKey = 'access-tensor/current' } = {}) {
  if (!cas || typeof cas.putObject !== 'function' || typeof cas.writeRef !== 'function') {
    throw new TypeError('peer CAS with immutable object writes and atomic reference swaps is required');
  }
  if (!safePath(pointerKey)) throw new TypeError('invalid tensor pointer key');
  const built = tensor?.kind === 'apex.access-tensor.v1' ? { tensor, cid: cidFor(tensor) } : createAccessTensor(tensor);
  const stored = await cas.putObject(built.tensor);
  if (!/^[a-f0-9]{64}$/.test(String(stored?.hash || '')) || !Array.isArray(stored.receipts) || stored.receipts.length < cas.replicaCount) {
    throw new Error('access tensor lacks a verified content CID and replica receipts');
  }
  const pointer = { kind: 'apex.access-tensor-pointer.v1', version: 1, cid: stored.hash, tensorCid: built.cid };
  const swapped = await cas.writeRef(pointerKey, pointer, { expectedHash });
  return Object.freeze({ cid: stored.hash, tensorCid: built.cid, pointerHash: swapped.hash, receipts: stored.receipts });
}

function signedPayload(kind, payload) {
  return Object.freeze({ kind, version: 1, payload: Object.freeze({ ...payload }) });
}
function signEnvelope(kind, payload, privateKey) {
  if (!privateKey) throw new TypeError('private signing key is required');
  const envelope = signedPayload(kind, payload);
  const bytes = canonicalBytes(envelope);
  return Object.freeze({ ...envelope, signature: cryptoSign(null, bytes, privateKey).toString('base64'), cid: sha256(bytes) });
}
function verifyEnvelope(envelope, { kind, publicKey, now = Date.now(), maxAgeMs = 60000 } = {}) {
  if (!envelope || envelope.kind !== kind || envelope.version !== 1 || !envelope.payload ||
      typeof envelope.signature !== 'string' || !publicKey) return false;
  const bytes = canonicalBytes(signedPayload(kind, envelope.payload));
  if (sha256(bytes) !== envelope.cid || !cryptoVerify(null, bytes, publicKey, Buffer.from(envelope.signature, 'base64'))) return false;
  const createdAt = Number(envelope.payload.createdAt);
  return Number.isSafeInteger(createdAt) && createdAt <= now + 5000 && now - createdAt <= maxAgeMs;
}

export function mintCapability({ issuerApp, subjectApp, path, actions, expiresAt, privateKey, nonce = randomUUID() } = {}) {
  if (!APPS.has(issuerApp) || !APPS.has(subjectApp) || !safePath(path) ||
      !Array.isArray(actions) || !actions.length || actions.some(action => !ACTIONS.has(action)) ||
      !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) throw new TypeError('invalid scoped capability request');
  return signEnvelope('apex.cross-app-capability.v1', {
    issuerApp, subjectApp, path, actions: [...new Set(actions)].sort(), expiresAt, nonce, createdAt: Date.now()
  }, privateKey);
}

export function verifyCapability(capability, { publicKey, subjectApp, action, path, now = Date.now(), isRevoked = () => false } = {}) {
  if (!verifyEnvelope(capability, { kind: 'apex.cross-app-capability.v1', publicKey, now, maxAgeMs: 24 * 60 * 60 * 1000 })) return false;
  const p = capability.payload;
  return APPS.has(p.issuerApp) && p.subjectApp === subjectApp && APPS.has(subjectApp) &&
    ACTIONS.has(action) && Array.isArray(p.actions) && p.actions.includes(action) &&
    safePath(path) && (path === p.path || path.startsWith(p.path + '/')) &&
    Number.isSafeInteger(p.expiresAt) && p.expiresAt > now && typeof p.nonce === 'string' && !isRevoked(p.nonce);
}

export function createSignedHeartbeat({ peerId, hardwareRootCid, privateKey, createdAt = Date.now() } = {}) {
  if (typeof peerId !== 'string' || !peerId || typeof hardwareRootCid !== 'string' ||
      !/^[a-f0-9]{64}$/.test(hardwareRootCid)) throw new TypeError('heartbeat requires a peer ID and hardware-root evidence CID');
  return signEnvelope('apex.peer-heartbeat.v1', { peerId, hardwareRootCid, createdAt }, privateKey);
}

export function verifySignedHeartbeat(heartbeat, { publicKey, expectedPeerId, now = Date.now(), maxAgeMs = 30000 } = {}) {
  return verifyEnvelope(heartbeat, { kind: 'apex.peer-heartbeat.v1', publicKey, now, maxAgeMs }) &&
    heartbeat.payload.peerId === expectedPeerId && /^[a-f0-9]{64}$/.test(heartbeat.payload.hardwareRootCid);
}

export function createCapabilityAdvertisement({ peerId, app, hardwareRootCid, cids = [], privateKey, createdAt = Date.now() } = {}) {
  if (typeof peerId !== 'string' || !peerId || !APPS.has(app) ||
      !/^[a-f0-9]{64}$/.test(String(hardwareRootCid || '')) ||
      !Array.isArray(cids) || cids.length > 100000 ||
      cids.some(cid => !/^[a-f0-9]{64}$/.test(String(cid)))) throw new TypeError('invalid peer capability advertisement');
  return signEnvelope('apex.peer-capabilities.v1', {
    peerId, app, hardwareRootCid, cids: [...new Set(cids)].sort(), createdAt
  }, privateKey);
}

export function verifyCapabilityAdvertisement(advertisement, { publicKey, expectedPeerId, app, now = Date.now(), maxAgeMs = 60000 } = {}) {
  return verifyEnvelope(advertisement, { kind: 'apex.peer-capabilities.v1', publicKey, now, maxAgeMs }) &&
    advertisement.payload.peerId === expectedPeerId && advertisement.payload.app === app &&
    APPS.has(app) && /^[a-f0-9]{64}$/.test(advertisement.payload.hardwareRootCid) &&
    Array.isArray(advertisement.payload.cids) && advertisement.payload.cids.every(cid => /^[a-f0-9]{64}$/.test(cid));
}

/** Connection-local elevation expires on connection close or credential rotation. */
export class ConnectionTrustSessions {
  #sessions = new WeakMap();
  async elevate(connection, { credentialFingerprint, attestation, verifyCredential, verifyAttestation } = {}) {
    if (!connection || (typeof connection !== 'object' && typeof connection !== 'function') ||
        typeof credentialFingerprint !== 'string' || !credentialFingerprint ||
        typeof verifyCredential !== 'function' || typeof verifyAttestation !== 'function') {
      throw new TypeError('connection, credential fingerprint, and independent credential/attestation verifiers are required');
    }
    if (connection.closed === true || !await verifyCredential(connection) || !await verifyAttestation(attestation, connection)) {
      throw new Error('connection trust elevation failed closed');
    }
    const session = Object.freeze({ credentialFingerprint, elevatedAt: Date.now(), attestationCid: cidFor(attestation) });
    this.#sessions.set(connection, session);
    return session;
  }
  isElevated(connection, credentialFingerprint) {
    const session = connection && this.#sessions.get(connection);
    return Boolean(session && connection.closed !== true && session.credentialFingerprint === credentialFingerprint);
  }
  revoke(connection) { if (connection) this.#sessions.delete(connection); }
}
