import { createHash, sign, verify, randomUUID } from 'node:crypto';
import { encodeCanonical } from './apex-cbor.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const CID = /^[a-f0-9]{64}$/;
const APPS = new Set(['KernelVision', 'XShield', 'Kernelodies', 'PlanetApeX', 'KashKorner', 'KoinKob']);
const now = () => Date.now();

export function cidFor(value) {
  const bytes = Buffer.isBuffer(value) ? value : encodeCanonical(value);
  return sha256(bytes);
}

export function assertCid(value) {
  if (!CID.test(String(value || ''))) throw new TypeError('invalid SHA-256 CID');
  return String(value);
}

/** Disposable, integrity-checked RAM cache. Never reads or writes a filesystem. */
export class VerifiedRamCache {
  constructor({ maxBytes = 32 * 1024 * 1024, ttlMs = 15000, clock = now } = {}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || !Number.isFinite(ttlMs) || ttlMs < 0) {
      throw new TypeError('cache size and TTL must be finite non-negative values');
    }
    this.maxBytes = maxBytes; this.ttlMs = ttlMs; this.clock = clock;
    this.entries = new Map(); this.bytes = 0;
    this.metrics = { hits: 0, misses: 0, evictions: 0, integrityRejects: 0 };
  }
  get(cid) {
    assertCid(cid);
    const entry = this.entries.get(cid);
    if (!entry || entry.expiresAt <= this.clock()) {
      if (entry) this.#remove(cid, false);
      this.metrics.misses++; return null;
    }
    if (sha256(entry.bytes) !== cid) {
      this.#remove(cid, false); this.metrics.integrityRejects++; this.metrics.misses++; return null;
    }
    this.entries.delete(cid); this.entries.set(cid, entry);
    this.metrics.hits++; return Buffer.from(entry.bytes);
  }
  set(cid, bytes, { ttlMs = this.ttlMs } = {}) {
    assertCid(cid);
    const payload = Buffer.from(bytes);
    if (sha256(payload) !== cid) throw new Error('RAM cache refused bytes that do not match their CID');
    if (payload.length > this.maxBytes || ttlMs <= 0 || this.maxBytes === 0) return false;
    this.#remove(cid, false);
    while (this.bytes + payload.length > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) return false;
      this.#remove(oldest, true);
    }
    this.entries.set(cid, { bytes: payload, expiresAt: this.clock() + ttlMs });
    this.bytes += payload.length; return true;
  }
  #remove(cid, eviction) {
    const entry = this.entries.get(cid);
    if (!entry) return;
    this.entries.delete(cid); this.bytes -= entry.bytes.length;
    if (eviction) this.metrics.evictions++;
  }
  clear() { this.entries.clear(); this.bytes = 0; }
}

/** Connection-local elevation is invalidated on credential rotation or connection close. */
export class ConnectionTrustSessions {
  constructor({ verifyHardwareAttestation, verifyAppCredential, clock = now } = {}) {
    if (typeof verifyHardwareAttestation !== 'function' || typeof verifyAppCredential !== 'function') {
      throw new TypeError('hardware attestation and app credential verifiers are mandatory');
    }
    this.verifyHardwareAttestation = verifyHardwareAttestation;
    this.verifyAppCredential = verifyAppCredential; this.clock = clock;
    this.sessions = new WeakMap();
  }
  async elevate(connection, { challenge, attestation, credential, app, credentialVersion }) {
    if (!connection || typeof connection !== 'object' || !APPS.has(app) ||
        !challenge || !credentialVersion) throw new TypeError('connection, challenge, app, and credential version are required');
    const prior = this.sessions.get(connection);
    if (prior && prior.app === app && prior.credentialVersion === credentialVersion && prior.expiresAt > this.clock()) return prior;
    const hardware = await this.verifyHardwareAttestation({ connection, challenge, attestation, app });
    if (hardware?.verified !== true || !hardware.rootId || !hardware.failureDomain) {
      throw new Error('hardware-rooted attestation not verified; connection remains untrusted');
    }
    const appProof = await this.verifyAppCredential({ credential, app, challenge, hardwareRootId: hardware.rootId });
    if (appProof?.verified !== true || appProof.app !== app || appProof.credentialVersion !== credentialVersion) {
      throw new Error('app credential invalid or mismatched; connection remains untrusted');
    }
    const session = Object.freeze({ app, rootId: hardware.rootId, failureDomain: hardware.failureDomain,
      credentialVersion, elevatedAt: this.clock(), expiresAt: Math.min(Number(hardware.expiresAt) || Infinity,
      Number(appProof.expiresAt) || Infinity) });
    this.sessions.set(connection, session); return session;
  }
  get(connection, { app, credentialVersion } = {}) {
    const session = connection && this.sessions.get(connection);
    if (!session || session.expiresAt <= this.clock() || session.app !== app ||
        session.credentialVersion !== credentialVersion) return null;
    return session;
  }
  revoke(connection) { if (connection && typeof connection === 'object') this.sessions.delete(connection); }
}

/** Signed, versioned namespace ACL tensor. Pointer publication is one peer CAS. */
export async function publishAccessTensor({ cas, app, tensor, expectedHeadHash = null }) {
  if (!cas || typeof cas.writeRef !== 'function' || !APPS.has(app)) throw new TypeError('app-scoped peer CAS required');
  const canonical = { schema: 'apex.namespace-access-tensor.v1', app, version: 1, tensor };
  const cid = cidFor(canonical);
  const stored = await cas.writeRef('access-tensors', cid, canonical, { expectedHash: null });
  if (stored?.hash && stored.hash !== cid) throw new Error('access tensor storage hash mismatch');
  await cas.writeRef('access-tensor-heads', app, { cid, app, schema: canonical.schema }, { expectedHash: expectedHeadHash });
  return { cid, headHash: stored?.hash ?? cid };
}

export function evaluateAccessTensor({ tensor, app, principal, namespace, action, nowMs = now() }) {
  if (!tensor || tensor.schema !== 'apex.namespace-access-tensor.v1' || tensor.app !== app ||
      !APPS.has(app) || !principal || !namespace || !action) return false;
  const rules = Array.isArray(tensor.tensor?.rules) ? tensor.tensor.rules : [];
  return rules.some(rule => rule.effect === 'allow' && rule.principal === principal &&
    rule.namespace === namespace && Array.isArray(rule.actions) && rule.actions.includes(action) &&
    (!rule.expiresAt || rule.expiresAt > nowMs));
}

export function mintScopedCapability({ issuerApp, subjectApp, namespace, pathPrefix, actions, expiresAt,
  nonce = randomUUID(), privateKey }) {
  if (!APPS.has(issuerApp) || !APPS.has(subjectApp) || !namespace || !pathPrefix ||
      !Array.isArray(actions) || !actions.length || !Number.isFinite(expiresAt) || expiresAt <= now() ||
      !privateKey) throw new TypeError('invalid scoped capability parameters');
  const payload = { schema: 'apex.scoped-capability.v1', issuerApp, subjectApp, namespace,
    pathPrefix, actions: [...new Set(actions)].sort(), expiresAt, nonce };
  const bytes = encodeCanonical(payload);
  return { cid: sha256(bytes), payload, signature: sign(null, bytes, privateKey).toString('base64') };
}

export function verifyScopedCapability(capability, { publicKey, app, namespace, path, action, clock = now() } = {}) {
  try {
    const p = capability?.payload;
    if (!p || p.schema !== 'apex.scoped-capability.v1' || p.subjectApp !== app ||
        !APPS.has(app) || p.namespace !== namespace || !String(path).startsWith(p.pathPrefix) ||
        !p.actions.includes(action) || p.expiresAt <= clock || !p.nonce ||
        !CID.test(capability.cid) || sha256(encodeCanonical(p)) !== capability.cid) return false;
    return verify(null, encodeCanonical(p), publicKey, Buffer.from(capability.signature, 'base64'));
  } catch { return false; }
}

export function signPeerStatement(payload, privateKey) {
  const bytes = encodeCanonical(payload);
  return { cid: sha256(bytes), payload, signature: sign(null, bytes, privateKey).toString('base64') };
}
export function verifyPeerStatement(statement, publicKey) {
  try {
    return Boolean(statement?.payload && CID.test(statement.cid) &&
      sha256(encodeCanonical(statement.payload)) === statement.cid &&
      verify(null, encodeCanonical(statement.payload), publicKey, Buffer.from(statement.signature, 'base64')));
  } catch { return false; }
}

export function createSignedHeartbeat({ peerId, hardwareRootId, appNamespaces, issuedAt = now(), expiresAt, privateKey }) {
  if (!peerId || !hardwareRootId || !Array.isArray(appNamespaces) ||
      !appNamespaces.every(app => APPS.has(app)) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) {
    throw new TypeError('heartbeat requires verified peer identity, app list, and bounded expiry');
  }
  return signPeerStatement({ schema: 'apex.peer-heartbeat.v1', peerId, hardwareRootId,
    appNamespaces: [...new Set(appNamespaces)].sort(), issuedAt, expiresAt }, privateKey);
}

export function createSignedCapabilityAdvertisement({ peerId, hardwareRootId, appNamespaces, cids,
  issuedAt = now(), expiresAt, privateKey }) {
  if (!peerId || !hardwareRootId || !Array.isArray(appNamespaces) ||
      !appNamespaces.every(app => APPS.has(app)) || !Array.isArray(cids) ||
      !cids.every(cid => CID.test(cid)) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) {
    throw new TypeError('capability advertisement requires verified identity, canonical CIDs, and expiry');
  }
  return signPeerStatement({ schema: 'apex.peer-capabilities.v1', peerId, hardwareRootId,
    appNamespaces: [...new Set(appNamespaces)].sort(), cids: [...new Set(cids)].sort(), issuedAt, expiresAt }, privateKey);
}

/** Rarest-first, bounded parallel pulls. Each peer response is checked before use. */
export async function fetchChunksRarestFirst({ chunks, peersForCid, fetchFromPeer, verifyChunk,
  concurrency = 8, clock = now }) {
  if (!Array.isArray(chunks) || typeof peersForCid !== 'function' ||
      typeof fetchFromPeer !== 'function' || typeof verifyChunk !== 'function') throw new TypeError('chunk fetch dependencies required');
  const limit = Math.max(1, Math.min(32, Math.floor(concurrency)));
  const plan = await Promise.all(chunks.map(async chunk => {
    assertCid(chunk.cid);
    const peers = [...new Set(await peersForCid(chunk.cid))];
    if (!peers.length) throw new Error('no authorized peer advertises required chunk ' + chunk.cid);
    return { ...chunk, peers, rarity: peers.length };
  }));
  plan.sort((a, b) => a.rarity - b.rarity || a.cid.localeCompare(b.cid));
  const result = new Map(); let cursor = 0;
  const worker = async () => {
    while (true) {
      const index = cursor++;
      if (index >= plan.length) return;
      const item = plan[index]; let lastError;
      for (const peer of item.peers) {
        try {
          const bytes = Buffer.from(await fetchFromPeer(peer, item.cid));
          if (sha256(bytes) !== item.cid || !(await verifyChunk({ peer, cid: item.cid, bytes }))) {
            throw new Error('chunk failed CID or peer authorization verification');
          }
          result.set(item.cid, bytes); lastError = null; break;
        } catch (error) { lastError = error; }
      }
      if (lastError) throw lastError;
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, plan.length) }, worker));
  return result;
}

/** Re-replicate only immutable CIDs whose verified replica count is below target. */
export async function repairUnderReplicatedCids({ cids, inspectReplicas, fetchVerified, storeReplica,
  targetReplicas, concurrency = 4 }) {
  if (!Number.isSafeInteger(targetReplicas) || targetReplicas < 1) throw new TypeError('target replica count required');
  const queue = [...new Set(cids.map(assertCid))]; let cursor = 0;
  const outcomes = [];
  const worker = async () => {
    while (true) {
      const cid = queue[cursor++]; if (!cid) return;
      const current = await inspectReplicas(cid);
      if (!Array.isArray(current?.verifiedPeerIds)) throw new Error('replica inspector must return verified peer IDs');
      const unique = new Set(current.verifiedPeerIds);
      if (unique.size >= targetReplicas) { outcomes.push({ cid, repaired: 0, replicas: unique.size }); continue; }
      const bytes = Buffer.from(await fetchVerified(cid, [...unique]));
      if (sha256(bytes) !== cid) throw new Error('repair source returned bytes that do not match CID');
      const added = await storeReplica(cid, bytes, [...unique], targetReplicas - unique.size);
      if (!Array.isArray(added?.verifiedPeerIds)) throw new Error('repair store must return verified replica receipts');
      for (const id of added.verifiedPeerIds) unique.add(id);
      if (unique.size < targetReplicas) throw new Error('REPAIR_INCOMPLETE: peer mesh remains under-replicated');
      outcomes.push({ cid, repaired: unique.size - current.verifiedPeerIds.length, replicas: unique.size });
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), queue.length) }, worker));
  return outcomes;
}

export async function publishJobResultCid({ cas, jobCid, resultBytes, expectedHash = null }) {
  assertCid(jobCid);
  const bytes = Buffer.from(resultBytes); const resultCid = sha256(bytes);
  const receipt = await cas.putBlob(bytes);
  if (receipt?.hash !== resultCid || receipt?.contentSha256 !== resultCid) throw new Error('job result CID/replica receipt mismatch');
  const pointer = await cas.writeRef('job-results', jobCid, { schema: 'apex.job-result.v1', jobCid, resultCid,
    bytes: bytes.length, completedAt: now() }, { expectedHash });
  return { jobCid, resultCid, pointerHash: pointer?.hash ?? null, receipt };
}
