import { createHash, sign as cryptoSign, verify as cryptoVerify, randomUUID } from 'node:crypto';
import { encodeCanonical } from './apex-cbor.mjs';

const APPS = new Set(['KernelVision', 'XShield', 'Kernelodies', 'PlanetApeX', 'KashKorner', 'KoinKob']);
const ACTIONS = new Set(['read', 'write', 'delete', 'claim', 'publish', 'delegate']);
const MAX_CAPABILITY_TTL_MS = 5 * 60 * 1000;
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

export function createAccessTensor({ version = 1, parentCid = null, rules = [], quotas = {} } = {}) {
  if (!Number.isSafeInteger(version) || version < 1 || (parentCid != null && !/^[a-f0-9]{64}$/.test(String(parentCid))) || (version > 1 && parentCid == null)) {
    throw new TypeError('access tensor versions after the first must name a valid parent CID');
  }
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
  const tensor = Object.freeze({ kind: 'apex.access-tensor.v1', version, ...(parentCid ? { parentCid } : {}), rules: normalized, quotas: Object.freeze(boundedQuotas) });
  return Object.freeze({ tensor, cid: cidFor(tensor) });
}

export function evaluateAccessTensor(tensor, { app, action, path, usage = {} } = {}) {
  if (!tensor || tensor.kind !== 'apex.access-tensor.v1' || !Number.isSafeInteger(tensor.version) || tensor.version < 1 ||
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
  const built = createAccessTensor(tensor?.kind === 'apex.access-tensor.v1'
    ? { version: tensor.version, parentCid: tensor.parentCid ?? null, rules: tensor.rules, quotas: tensor.quotas }
    : tensor);
  const stored = await cas.putObject(built.tensor);
  const receipts = Array.isArray(stored?.receipts) ? stored.receipts : [];
  const verifiedPeers = new Set(receipts.filter(receipt =>
    typeof receipt?.peerId === 'string' && receipt.peerId &&
    receipt.hash === stored?.hash && receipt.namespace === cas.namespace &&
    typeof receipt.receiptId === 'string' && receipt.receiptId && receipt.durabilityReceipt != null
  ).map(receipt => receipt.peerId));
  if (!/^[a-f0-9]{64}$/.test(String(stored?.hash || '')) || verifiedPeers.size < Number(cas.replicaCount || 1)) {
    throw new Error('access tensor lacks distinct, namespace-bound durability receipts');
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
      !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || expiresAt - Date.now() > MAX_CAPABILITY_TTL_MS) throw new TypeError('invalid or overlong scoped capability request');
  return signEnvelope('apex.cross-app-capability.v1', {
    issuerApp, subjectApp, path, actions: [...new Set(actions)].sort(), expiresAt, nonce, createdAt: Date.now()
  }, privateKey);
}

export class CapabilityReplayGuard {
  #seen = new Map();
  constructor({ maxEntries = 100000 } = {}) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new TypeError('replay guard capacity must be positive');
    this.maxEntries = maxEntries;
  }
  consume(requestKey, expiresAt, now = Date.now()) {
    if (typeof requestKey !== 'string' || !requestKey || !Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;
    for (const [key, expiry] of this.#seen) if (expiry <= now) this.#seen.delete(key);
    if (this.#seen.has(requestKey) || this.#seen.size >= this.maxEntries) return false;
    this.#seen.set(requestKey, expiresAt);
    return true;
  }
  get size() { return this.#seen.size; }
}

export function verifyCapability(capability, {
  publicKey, subjectApp, action, path, requestId, replayGuard, now = Date.now(), isRevoked = () => false
} = {}) {
  if (!verifyEnvelope(capability, { kind: 'apex.cross-app-capability.v1', publicKey, now, maxAgeMs: MAX_CAPABILITY_TTL_MS })) return false;
  const p = capability.payload;
  const authorized = APPS.has(p.issuerApp) && p.subjectApp === subjectApp && APPS.has(subjectApp) &&
    ACTIONS.has(action) && Array.isArray(p.actions) && p.actions.includes(action) &&
    safePath(path) && (path === p.path || path.startsWith(p.path + '/')) &&
    Number.isSafeInteger(p.expiresAt) && p.expiresAt > now &&
    p.expiresAt - Number(p.createdAt) <= MAX_CAPABILITY_TTL_MS &&
    typeof p.nonce === 'string' && !isRevoked(p.nonce);
  if (!authorized || typeof requestId !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(requestId) ||
      !replayGuard || typeof replayGuard.consume !== 'function') return false;
  return replayGuard.consume(p.nonce + ':' + requestId, p.expiresAt, now);
}

export function createSignedHeartbeat({ peerId, hardwareRootCid, privateKey, createdAt = Date.now() } = {}) {
  if (typeof peerId !== 'string' || !peerId || typeof hardwareRootCid !== 'string' ||
      !/^[a-f0-9]{64}$/.test(hardwareRootCid)) throw new TypeError('heartbeat requires a peer ID and hardware-root evidence CID');
  return signEnvelope('apex.peer-heartbeat.v1', { peerId, hardwareRootCid, createdAt }, privateKey);
}

export async function verifySignedHeartbeat(heartbeat, {
  publicKey, expectedPeerId, verifyHardwareRoot, now = Date.now(), maxAgeMs = 30000
} = {}) {
  if (!verifyEnvelope(heartbeat, { kind: 'apex.peer-heartbeat.v1', publicKey, now, maxAgeMs }) ||
      heartbeat.payload.peerId !== expectedPeerId ||
      !/^[a-f0-9]{64}$/.test(heartbeat.payload.hardwareRootCid) ||
      typeof verifyHardwareRoot !== 'function') return false;
  return await verifyHardwareRoot({
    hardwareRootCid: heartbeat.payload.hardwareRootCid,
    peerId: heartbeat.payload.peerId,
    createdAt: heartbeat.payload.createdAt
  }) === true;
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

export async function verifyCapabilityAdvertisement(advertisement, {
  publicKey, expectedPeerId, app, verifyHardwareRoot, now = Date.now(), maxAgeMs = 60000
} = {}) {
  if (!verifyEnvelope(advertisement, { kind: 'apex.peer-capabilities.v1', publicKey, now, maxAgeMs }) ||
      advertisement.payload.peerId !== expectedPeerId || advertisement.payload.app !== app ||
      !APPS.has(app) || !/^[a-f0-9]{64}$/.test(advertisement.payload.hardwareRootCid) ||
      !Array.isArray(advertisement.payload.cids) ||
      !advertisement.payload.cids.every(cid => /^[a-f0-9]{64}$/.test(cid)) ||
      typeof verifyHardwareRoot !== 'function') return false;
  return await verifyHardwareRoot({
    hardwareRootCid: advertisement.payload.hardwareRootCid,
    peerId: advertisement.payload.peerId,
    app: advertisement.payload.app,
    createdAt: advertisement.payload.createdAt
  }) === true;
}

/** Plan bounded multi-peer fetches; caller must supply already signature-verified advertisements. */
export function planRarestFirstChunks(chunks, verifiedAdvertisements, { app, maxPeersPerChunk = 4 } = {}) {
  if (!APPS.has(app) || !Array.isArray(chunks) || !Array.isArray(verifiedAdvertisements) ||
      !Number.isSafeInteger(maxPeersPerChunk) || maxPeersPerChunk < 1 || maxPeersPerChunk > 16) {
    throw new TypeError('invalid rarest-first chunk planning input');
  }
  const availability = new Map();
  for (const advertisement of verifiedAdvertisements) {
    const payload = advertisement?.payload;
    if (advertisement?.kind !== 'apex.peer-capabilities.v1' || payload?.app !== app ||
        !Array.isArray(payload.cids) || typeof payload.peerId !== 'string') continue;
    for (const cid of new Set(payload.cids)) {
      if (!/^[a-f0-9]{64}$/.test(String(cid))) continue;
      const peers = availability.get(cid) || new Set();
      peers.add(payload.peerId);
      availability.set(cid, peers);
    }
  }
  const seen = new Set();
  const planned = chunks.map(chunk => {
    const cid = String(chunk?.hash || chunk?.cid || '');
    if (!/^[a-f0-9]{64}$/.test(cid) || seen.has(cid)) throw new TypeError('chunk plan contains an invalid or duplicate CID');
    seen.add(cid);
    const peers = [...(availability.get(cid) || [])].sort();
    return { ...chunk, cid, availablePeerCount: peers.length, sourcePeers: peers.slice(0, maxPeersPerChunk) };
  });
  return planned.sort((a, b) => a.availablePeerCount - b.availablePeerCount || a.cid.localeCompare(b.cid));
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
    if (connection.closed === true || !await verifyCredential(connection, { credentialFingerprint }) ||
        !await verifyAttestation(attestation, connection, { credentialFingerprint })) {
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
