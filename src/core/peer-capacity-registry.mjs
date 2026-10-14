const APPS = new Set(['KernelVision', 'XShield', 'Kernelodies', 'PlanetApeX', 'KashKorner', 'KoinKob']);
const HASH = /^[a-f0-9]{64}$/;
const STAGES = new Set(['locally_committed', 'readback_verified', 'restart_recovery_verified']);

const nowMs = clock => Number(clock());
const validPeer = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const validApp = value => APPS.has(value);

/**
 * In-memory broker-side peer capacity/receipt registry.
 * This registry never stores payload bytes and never treats the broker as storage.
 * Callers must authenticate peer identity and authorize app namespace before invoking it.
 */
export class PeerCapacityRegistry {
  constructor({ leaseMs = 30_000, clock = Date.now } = {}) {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000) throw new TypeError('leaseMs must be at least 1000');
    this.leaseMs = leaseMs;
    this.clock = clock;
    this.peers = new Map();
    this.payloads = new Map();
  }

  advertise({ peerId, role, durableCapacityBytes = 0, appNamespaces = [], sessionId }) {
    if (!validPeer(peerId) || !validPeer(sessionId)) throw new TypeError('peerId and sessionId are required');
    if (!['broker', 'mobile-storage'].includes(role)) throw new TypeError('unsupported peer role');
    if (!Number.isSafeInteger(durableCapacityBytes) || durableCapacityBytes < 0) throw new TypeError('capacity must be a non-negative integer');
    if (!Array.isArray(appNamespaces) || appNamespaces.some(app => !validApp(app))) throw new TypeError('invalid app namespace advertisement');
    if (role === 'broker' && durableCapacityBytes !== 0) throw new Error('broker role is always zero-capacity');
    const previous = this.peers.get(peerId);
    const freshSession = !previous || previous.sessionId !== sessionId;
    const peer = {
      peerId, role, durableCapacityBytes,
      appNamespaces: [...new Set(appNamespaces)],
      sessionId, connected: true, lastSeenAt: nowMs(this.clock),
      leaseExpiresAt: nowMs(this.clock) + this.leaseMs,
      freshSession
    };
    this.peers.set(peerId, peer);
    return { ...peer, appNamespaces: [...peer.appNamespaces] };
  }

  heartbeat({ peerId, sessionId }) {
    const peer = this.peers.get(peerId);
    if (!peer || !peer.connected || peer.sessionId !== sessionId) return { accepted: false, reason: 'unknown_or_stale_session' };
    peer.lastSeenAt = nowMs(this.clock);
    peer.leaseExpiresAt = peer.lastSeenAt + this.leaseMs;
    return { accepted: true, leaseExpiresAt: peer.leaseExpiresAt };
  }

  disconnect({ peerId, sessionId }) {
    const peer = this.peers.get(peerId);
    if (!peer || peer.sessionId !== sessionId) return false;
    peer.connected = false;
    peer.leaseExpiresAt = 0;
    for (const record of this.payloads.values()) {
      const replica = record.replicas.get(peerId);
      if (replica) replica.availability = 'unavailable';
    }
    return true;
  }

  sweepExpired() {
    const now = nowMs(this.clock);
    const expired = [];
    for (const peer of this.peers.values()) {
      if (peer.connected && peer.leaseExpiresAt <= now) {
        peer.connected = false;
        expired.push(peer.peerId);
        for (const record of this.payloads.values()) {
          const replica = record.replicas.get(peer.peerId);
          if (replica) replica.availability = 'unavailable';
        }
      }
    }
    return expired;
  }

  eligiblePeers(appNamespace) {
    if (!validApp(appNamespace)) throw new TypeError('invalid app namespace');
    this.sweepExpired();
    return [...this.peers.values()]
      .filter(p => p.connected && p.role === 'mobile-storage' && p.durableCapacityBytes > 0 && p.appNamespaces.includes(appNamespace))
      .map(p => ({ peerId: p.peerId, sessionId: p.sessionId, capacityBytes: p.durableCapacityBytes, leaseExpiresAt: p.leaseExpiresAt }));
  }

  beginPayload({ hash, appNamespace, expectedBytes, sourcePeerId }) {
    if (!HASH.test(String(hash || ''))) throw new TypeError('payload address must be a lowercase SHA-256 hex digest');
    if (!validApp(appNamespace)) throw new TypeError('invalid app namespace');
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0) throw new TypeError('expectedBytes must be a non-negative integer');
    if (!this.eligiblePeers(appNamespace).length) throw new Error('no eligible durable storage peers; write rejected');
    const key = appNamespace + ':' + hash;
    const prior = this.payloads.get(key);
    if (prior && prior.expectedBytes !== expectedBytes) throw new Error('content address reused with conflicting byte length');
    if (!prior) this.payloads.set(key, { hash, appNamespace, expectedBytes, sourcePeerId: sourcePeerId || null, replicas: new Map(), createdAt: nowMs(this.clock) });
    return { accepted: true, hash, appNamespace, state: prior ? this.status(key) : 'pending' };
  }

  recordReceipt({ peerId, sessionId, hash, appNamespace, bytes, stage, readbackHash, receiptId }) {
    const key = appNamespace + ':' + hash;
    const record = this.payloads.get(key);
    const peer = this.peers.get(peerId);
    if (!record || !peer || !peer.connected || peer.sessionId !== sessionId || peer.leaseExpiresAt <= nowMs(this.clock)) {
      throw new Error('receipt rejected: unknown payload or expired peer session');
    }
    if (peer.role !== 'mobile-storage' || !peer.appNamespaces.includes(appNamespace) || record.appNamespace !== appNamespace) {
      throw new Error('receipt rejected: peer role or app namespace mismatch');
    }
    if (!STAGES.has(stage) || bytes !== record.expectedBytes || readbackHash !== hash) {
      throw new Error('receipt rejected: stage, byte length, or SHA-256 read-back proof mismatch');
    }
    const previous = record.replicas.get(peerId);
    if (stage === 'restart_recovery_verified' && (!previous || previous.sessionId === sessionId || previous.stage !== 'readback_verified')) {
      throw new Error('restart recovery requires a read-back receipt from an earlier session');
    }
    if (stage === 'readback_verified' && (!previous || previous.sessionId !== sessionId) && stage !== 'locally_committed') {
      // A read-back can follow the local commit from the same session only.
      throw new Error('read-back receipt requires a locally committed receipt in the same session');
    }
    if (stage === 'readback_verified' && previous?.stage !== 'locally_committed' && previous?.stage !== 'readback_verified') {
      throw new Error('read-back receipt requires a locally committed receipt');
    }
    if (stage === 'locally_committed' && previous && previous.sessionId === sessionId && previous.stage !== 'locally_committed') {
      throw new Error('receipt stage regression rejected');
    }
    const rank = { locally_committed: 1, readback_verified: 2, restart_recovery_verified: 3 };
    if (previous && previous.sessionId === sessionId && rank[stage] < rank[previous.stage]) throw new Error('receipt stage regression rejected');
    const receipt = {
      peerId, sessionId, stage, bytes, readbackHash,
      receiptId: String(receiptId || ''),
      availability: 'available',
      durableReplica: stage === 'restart_recovery_verified',
      verifiedAt: nowMs(this.clock)
    };
    if (!receipt.receiptId) throw new Error('receiptId is required');
    record.replicas.set(peerId, receipt);
    return { ...receipt, payloadState: this.status(key) };
  }

  status(keyOrAddress) {
    let record = this.payloads.get(keyOrAddress);
    if (!record && typeof keyOrAddress === 'string' && keyOrAddress.includes(':')) record = this.payloads.get(keyOrAddress);
    if (!record) return { state: 'unknown', durableReplicas: 0, replicas: [] };
    this.sweepExpired();
    const replicas = [...record.replicas.values()].map(replica => {
      const peer = this.peers.get(replica.peerId);
      const available = Boolean(peer?.connected && peer.sessionId === replica.sessionId && peer.leaseExpiresAt > nowMs(this.clock));
      return { ...replica, availability: available ? replica.availability : 'unavailable', durableReplica: replica.durableReplica && available };
    });
    const durableReplicas = replicas.filter(r => r.durableReplica && r.availability === 'available').length;
    const states = replicas.map(r => r.stage);
    const state = durableReplicas > 0 ? 'restart_recovery_verified' :
      states.includes('readback_verified') ? 'readback_verified' :
      states.includes('locally_committed') ? 'locally_committed' : 'pending';
    return { hash: record.hash, appNamespace: record.appNamespace, state, durableReplicas, replicas };
  }

  getPayloadStatus({ hash, appNamespace }) {
    if (!HASH.test(String(hash || '')) || !validApp(appNamespace)) throw new TypeError('invalid payload address or namespace');
    return this.status(appNamespace + ':' + hash);
  }
}
