import { createHash, randomUUID } from 'node:crypto';

// Defense-in-depth for the APEX sovereign peer transport.
// Transport encryption/authentication is provided by libp2p Noise; this module
// adds bounded per-peer admission and replay detection without changing app roles
// or granting/revoking any APEX user privilege.
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 120;
const MAX_TRACKED_PEERS = 10_000;
const MAX_REPLAY_ENTRIES = 20_000;
const REPLAY_TTL_MS = 10 * 60_000;

const RESERVED_FIELDS = new Set(['messageId', 'senderPeerId', 'senderEpoch', 'issuedAt', 'requestDigest']);
const payloadDigest = envelope => {
  const payload = Object.fromEntries(Object.entries(envelope).filter(([key]) => key !== 'requestDigest'));
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
};

/** Bind a request payload, sender identity, trust epoch, freshness, and message ID. */
export function sealPeerEnvelope(envelope, senderPeerId, now = Date.now()) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new TypeError('peer envelope must be an object');
  }
  const payload = Object.fromEntries(Object.entries(envelope).filter(([key]) => !RESERVED_FIELDS.has(key)));
  const sealed = {
    ...payload,
    messageId: randomUUID(),
    senderPeerId: String(senderPeerId || ''),
    senderEpoch: Number(process.env.APEX_PEER_TRUST_EPOCH ?? 0),
    issuedAt: Number(now)
  };
  return { ...sealed, requestDigest: payloadDigest(sealed) };
}

/** Reject payload tampering, sender-identity mismatch, and stale peer requests. */
export function verifyPeerEnvelope(envelope, remotePeerId, now = Date.now(), maxAgeMs = 5 * 60_000) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return { allowed: false, reason: 'peer envelope must be an object' };
  }
  if (typeof envelope.messageId !== 'string' || !/^[0-9a-f-]{36}$/i.test(envelope.messageId)) {
    return { allowed: false, reason: 'invalid peer message identifier' };
  }
  if (!remotePeerId || envelope.senderPeerId !== String(remotePeerId)) {
    return { allowed: false, reason: 'peer sender identity does not match authenticated transport identity' };
  }
  if (!Number.isSafeInteger(envelope.senderEpoch) || envelope.senderEpoch < 0) {
    return { allowed: false, reason: 'peer trust epoch is invalid' };
  }
  if (!Number.isSafeInteger(envelope.issuedAt) || envelope.issuedAt > now + 60_000 ||
      now - envelope.issuedAt > maxAgeMs) {
    return { allowed: false, reason: 'peer request timestamp is stale or invalid' };
  }
  if (typeof envelope.requestDigest !== 'string' ||
      !/^[a-f0-9]{64}$/.test(envelope.requestDigest) ||
      payloadDigest(envelope) !== envelope.requestDigest) {
    return { allowed: false, reason: 'peer request digest verification failed' };
  }
  return { allowed: true };
}

function positiveInteger(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.max(1, Math.floor(parsed)));
}

export function createPeerSecurityGuard({
  now = () => Date.now(),
  windowMs = positiveInteger(process.env.APEX_PEER_RATE_WINDOW_MS, DEFAULT_WINDOW_MS, 3_600_000),
  limit = positiveInteger(process.env.APEX_PEER_RATE_LIMIT, DEFAULT_LIMIT, 100_000),
  replayTtlMs = REPLAY_TTL_MS,
  trustEpochs = new Map(),
  requireTrustEpochs = false,
  maxCachedResponseBytes = 8 * 1024 * 1024,
  maxCachedResponseBytesPerEntry = 64 * 1024
} = {}) {
  const windows = new Map();
  const replay = new Map();
  let cachedResponseBytes = 0;
  const totalResponseBudget = positiveInteger(maxCachedResponseBytes, 8 * 1024 * 1024, 64 * 1024 * 1024);
  const singleResponseBudget = positiveInteger(maxCachedResponseBytesPerEntry, 64 * 1024, 1024 * 1024);

  function pruneReplay(time) {
    for (const [key, entry] of replay) {
      if (entry.expiresAt <= time) {
        cachedResponseBytes -= entry.responseBytes || 0;
        replay.delete(key);
      }
    }
    while (replay.size >= MAX_REPLAY_ENTRIES) {
      const oldest = replay.keys().next().value;
      if (oldest === undefined) break;
      const entry = replay.get(oldest);
      cachedResponseBytes -= entry?.responseBytes || 0;
      replay.delete(oldest);
    }
  }

  function admit(peerId, envelope) {
    const peer = String(peerId || '').trim();
    if (!peer || peer.length > 256) return { allowed: false, reason: 'invalid peer identity' };
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
      return { allowed: false, reason: 'envelope must be an object' };
    }
    const time = now();
    let bucket = windows.get(peer);
    if (!bucket || time - bucket.startedAt >= Math.max(1000, windowMs) || time < bucket.startedAt) {
      if (windows.size >= MAX_TRACKED_PEERS && !windows.has(peer)) {
        const oldest = windows.keys().next().value;
        if (oldest !== undefined) windows.delete(oldest);
      }
      bucket = { startedAt: time, count: 0 };
      windows.set(peer, bucket);
    }
    bucket.count += 1;
    if (bucket.count > Math.max(1, limit)) {
      return { allowed: false, reason: 'peer rate limit exceeded' };
    }

    const trust = trustEpochs instanceof Map ? trustEpochs.get(peer) : trustEpochs?.[peer];
    if (trust == null && requireTrustEpochs) {
      return { allowed: false, reason: 'peer trust epoch is not configured' };
    }
    if (trust != null) {
      const expectedEpoch = Number(typeof trust === 'object' ? trust.epoch : trust);
      const revoked = typeof trust === 'object' && (trust.revoked === true || trust.status === 'revoked');
      if (revoked) return { allowed: false, reason: 'peer trust epoch is revoked' };
      if (!Number.isSafeInteger(expectedEpoch) || expectedEpoch < 0 || envelope.senderEpoch !== expectedEpoch) {
        return { allowed: false, reason: 'peer trust epoch mismatch' };
      }
    }

    const id = envelope.messageId ?? envelope.nonce;
    if (id !== undefined && id !== null && id !== '') {
      if (typeof id !== 'string' || id.length > 256 || id.length < 8) {
        return { allowed: false, reason: 'invalid message identifier' };
      }
      pruneReplay(time);
      const replayKey = peer + ':' + id;
      if (replay.has(replayKey)) return { allowed: false, reason: 'replayed message rejected', replayKey };
      replay.set(replayKey, { expiresAt: time + Math.max(1000, replayTtlMs), response: null, responseBytes: 0 });
    }
    return { allowed: true };
  }

  function rememberResponse(peerId, envelope, response) {
    const id = envelope?.messageId ?? envelope?.nonce;
    if (typeof id !== 'string' || !id) return false;
    const entry = replay.get(String(peerId) + ':' + id);
    if (!entry) return false;
    let encoded;
    try { encoded = JSON.stringify(response); } catch { return false; }
    if (typeof encoded !== 'string') return false;
    const bytes = Buffer.byteLength(encoded);
    if (bytes > singleResponseBudget) return false;
    const previousBytes = entry.responseBytes || 0;
    if (cachedResponseBytes - previousBytes + bytes > totalResponseBudget) return false;
    entry.response = JSON.parse(encoded);
    entry.responseBytes = bytes;
    cachedResponseBytes += bytes - previousBytes;
    return true;
  }

  function getReplayResponse(peerId, envelope) {
    const id = envelope?.messageId ?? envelope?.nonce;
    if (typeof id !== 'string' || !id) return null;
    const entry = replay.get(String(peerId) + ':' + id);
    return entry?.response == null ? null : structuredClone(entry.response);
  }

  return { admit, rememberResponse, getReplayResponse };
}
