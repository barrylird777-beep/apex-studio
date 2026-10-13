// Defense-in-depth for the APEX sovereign peer transport.
// Transport encryption/authentication is provided by libp2p Noise; this module
// adds bounded per-peer admission and replay detection without changing app roles
// or granting/revoking any APEX user privilege.
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 120;
const MAX_TRACKED_PEERS = 10_000;
const MAX_REPLAY_ENTRIES = 20_000;
const REPLAY_TTL_MS = 10 * 60_000;

export function createPeerSecurityGuard({
  now = () => Date.now(),
  windowMs = Number(process.env.APEX_PEER_RATE_WINDOW_MS || DEFAULT_WINDOW_MS),
  limit = Number(process.env.APEX_PEER_RATE_LIMIT || DEFAULT_LIMIT),
  replayTtlMs = REPLAY_TTL_MS
} = {}) {
  const windows = new Map();
  const replay = new Map();

  function pruneReplay(time) {
    for (const [key, expiresAt] of replay) {
      if (expiresAt <= time) replay.delete(key);
    }
    while (replay.size >= MAX_REPLAY_ENTRIES) {
      const oldest = replay.keys().next().value;
      if (oldest === undefined) break;
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

    const id = envelope.messageId ?? envelope.nonce;
    if (id !== undefined && id !== null && id !== '') {
      if (typeof id !== 'string' || id.length > 256 || id.length < 8) {
        return { allowed: false, reason: 'invalid message identifier' };
      }
      pruneReplay(time);
      const replayKey = peer + ':' + id;
      if (replay.has(replayKey)) return { allowed: false, reason: 'replayed message rejected' };
      replay.set(replayKey, time + Math.max(1000, replayTtlMs));
    }
    return { allowed: true };
  }

  return { admit };
}
