const DEFAULTS = Object.freeze({ windowMs: 60_000, maxRequestsPerPeer: 60, maxConcurrentPerPeer: 8, maxConcurrentTotal: 128, maxTrackedPeers: 4096 });

export function createPeerIngressGuard(options = {}) {
  const config = { ...DEFAULTS, ...options };
  const peers = new Map();
  let activeTotal = 0;

  function prune(now) {
    for (const [peerId, state] of peers) {
      if (state.active === 0 && now - state.windowStart >= config.windowMs) peers.delete(peerId);
    }
    return peers.size < config.maxTrackedPeers;
  }

  function acquire(peerId) {
    const id = String(peerId || "");
    if (!id) return { ok: false, reason: "missing-peer-identity", release() {} };
    const now = Date.now();
    let state = peers.get(id);
    if (!state) {
      if (peers.size >= config.maxTrackedPeers && !prune(now)) return { ok: false, reason: "peer-tracking-capacity", release() {} };
      state = { windowStart: now, requests: 0, active: 0 };
      peers.set(id, state);
    }
    if (now - state.windowStart >= config.windowMs) {
      state.windowStart = now;
      state.requests = 0;
    }
    if (state.requests >= config.maxRequestsPerPeer) return { ok: false, reason: "peer-rate-limit", release() {} };
    if (state.active >= config.maxConcurrentPerPeer) return { ok: false, reason: "peer-concurrency-limit", release() {} };
    if (activeTotal >= config.maxConcurrentTotal) return { ok: false, reason: "network-concurrency-limit", release() {} };
    state.requests += 1;
    state.active += 1;
    activeTotal += 1;
    let released = false;
    return {
      ok: true,
      release() {
        if (released) return;
        released = true;
        state.active = Math.max(0, state.active - 1);
        activeTotal = Math.max(0, activeTotal - 1);
        if (state.active === 0 && Date.now() - state.windowStart >= config.windowMs) peers.delete(id);
      }
    };
  }

  return { acquire, snapshot: () => ({ trackedPeers: peers.size, activeTotal }) };
}
