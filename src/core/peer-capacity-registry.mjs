/**
 * In-memory control-plane registry for mobile peer capacity and recovery proofs.
 * This broker registry stores metadata only: never payload bytes or local files.
 * A restart loses leases by design; peers must re-advertise and prove recovery.
 */
const APP_IDS = new Set(['KernelVision', 'XShield', 'Kernelodies', 'PlanetApeX', 'KashKorner', 'KoinKob']);
const HASH_RE = /^[a-f0-9]{64}$/;
const ID_RE = /^[A-Za-z0-9._:-]{8,160}$/;

function required(value, label) {
  const text = String(value ?? '').trim();
  if (!text || !ID_RE.test(text)) throw new TypeError(label + ' is invalid');
  return text;
}

export class PeerCapacityRegistry {
  constructor({ leaseMs = 30_000, now = () => Date.now(), maxAdvertisedBytes = 1_000_000_000_000 } = {}) {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000) throw new TypeError('leaseMs must be at least 1000ms');
    if (typeof now !== 'function') throw new TypeError('now must be a function');
    this.leaseMs = leaseMs;
    this.now = now;
    this.maxAdvertisedBytes = maxAdvertisedBytes;
    this.peers = new Map();
    this.payloads = new Map();
  }

  expire() {
    const now = this.now();
    for (const peer of this.peers.values()) {
      if (peer.available && peer.leaseExpiresAt <= now) {
        peer.available = false;
        peer.expiredAt = now;
        for (const record of this.payloads.values()) {
          const replica = record.replicas.get(peer.peerId);
          if (replica) replica.availability = 'unavailable';
        }
      }
    }
  }

  advertise({ peerId, sessionId, capacityBytes, storageKind = 'indexeddb', appIds = [] } = {}) {
    this.expire();
    peerId = required(peerId, 'peerId');
    sessionId = required(sessionId, 'sessionId');
    if (!Number.isSafeInteger(capacityBytes) || capacityBytes < 0 || capacityBytes > this.maxAdvertisedBytes) {
      throw new TypeError('capacityBytes is outside the allowed range');
    }
    if (!['indexeddb', 'opfs'].includes(storageKind)) throw new TypeError('unsupported browser storage kind');
    if (!Array.isArray(appIds) || appIds.some(id => !APP_IDS.has(id)) || new Set(appIds).size !== appIds.length) {
      throw new TypeError('appIds must contain unique canonical app names only');
    }
    const previous = this.peers.get(peerId);
    const newSession = !previous || previous.sessionId !== sessionId;
    const peer = {
      peerId, sessionId, storageKind, appIds: [...appIds], capacityBytes,
      available: capacityBytes > 0,
      leaseExpiresAt: this.now() + this.leaseMs,
      advertisedAt: this.now(),
      lastHeartbeatAt: this.now()
    };
    this.peers.set(peerId, peer);
    if (newSession) {
      for (const record of this.payloads.values()) {
        const replica = record.replicas.get(peerId);
        if (replica) {
          replica.availability = 'unverified';
          replica.recoverySessionId = null;
          if (replica.state !== 'readback_verified') replica.state = 'session_changed';
        }
      }
    }
    return this.peerStatus(peerId);
  }

  heartbeat({ peerId, sessionId } = {}) {
    this.expire();
    peerId = required(peerId, 'peerId');
    sessionId = required(sessionId, 'sessionId');
    const peer = this.peers.get(peerId);
    if (!peer || peer.sessionId !== sessionId) throw new Error('unknown or stale peer session');
    peer.lastHeartbeatAt = this.now();
    peer.leaseExpiresAt = this.now() + this.leaseMs;
    peer.available = peer.capacityBytes > 0;
    return this.peerStatus(peerId);
  }

  beginWrite({ peerId, sessionId, namespace, hash, bytes } = {}) {
    this.expire();
    peerId = required(peerId, 'peerId');
    sessionId = required(sessionId, 'sessionId');
    if (!APP_IDS.has(namespace)) throw new TypeError('non-canonical app namespace');
    if (typeof hash !== 'string' || !HASH_RE.test(hash)) throw new TypeError('hash must be a lowercase SHA-256 hex digest');
    if (!Number.isSafeInteger(bytes) || bytes < 1) throw new TypeError('bytes must be a positive integer');
    const peer = this.peers.get(peerId);
    if (!peer || !peer.available || peer.leaseExpiresAt <= this.now() || peer.sessionId !== sessionId) {
      throw new Error('no eligible live storage peer; durable write rejected');
    }
    if (!peer.appIds.includes(namespace)) throw new Error('peer is not authorized for this app namespace');
    const key = namespace + ':' + hash;
    let record = this.payloads.get(key);
    if (!record) {
      record = { namespace, hash, bytes, replicas: new Map(), status: 'volatile' };
      this.payloads.set(key, record);
    } else if (record.bytes !== bytes) {
      throw new Error('content-address collision or inconsistent byte length');
    }
    record.replicas.set(peerId, {
      peerId, sessionId, state: 'write_acknowledged', availability: 'available',
      acknowledgedAt: this.now(), readbackAt: null, recoveryAt: null,
      recoverySessionId: null, lastProofHash: null
    });
    record.status = 'volatile';
    return { namespace, hash, state: 'write_acknowledged', status: record.status, durable: false };
  }

  acknowledgeWrite({ peerId, sessionId, namespace, hash, accepted } = {}) {
    this.expire();
    const record = this.getRecord(namespace, hash);
    const replica = this.getReplica(record, peerId, sessionId);
    if (accepted !== true) {
      replica.availability = 'unavailable';
      replica.state = 'write_failed';
      this.recompute(record);
      return this.status(namespace, hash);
    }
    replica.state = 'write_acknowledged';
    replica.acknowledgedAt = this.now();
    replica.availability = 'available';
    this.recompute(record);
    return this.status(namespace, hash);
  }

  verifyReadback({ peerId, sessionId, namespace, hash, proofHash } = {}) {
    this.expire();
    const record = this.getRecord(namespace, hash);
    const replica = this.getReplica(record, peerId, sessionId);
    if (replica.state !== 'write_acknowledged') throw new Error('read-back proof is out of order');
    if (proofHash !== hash) {
      replica.state = 'verification_failed';
      replica.availability = 'unavailable';
      this.recompute(record);
      throw new Error('read-back SHA-256 does not match content address');
    }
    replica.state = 'readback_verified';
    replica.readbackAt = this.now();
    replica.lastProofHash = proofHash;
    this.recompute(record);
    return this.status(namespace, hash);
  }

  verifyRecovery({ peerId, sessionId, namespace, hash, proofHash } = {}) {
    this.expire();
    const record = this.getRecord(namespace, hash);
    peerId = required(peerId, 'peerId');
    sessionId = required(sessionId, 'sessionId');
    const replica = record.replicas.get(peerId);
    const peer = this.peers.get(peerId);
    if (!replica || replica.state !== 'readback_verified') throw new Error('restart-recovery proof is out of order');
    if (!peer || peer.sessionId !== sessionId || sessionId === replica.sessionId) {
      throw new Error('recovery proof must come from the peer\'s new active browser session');
    }
    if (proofHash !== hash) {
      replica.state = 'verification_failed';
      replica.availability = 'unavailable';
      this.recompute(record);
      throw new Error('restart-recovery SHA-256 does not match content address');
    }
    replica.state = 'restart_recovery_verified';
    replica.recoveryAt = this.now();
    replica.recoverySessionId = sessionId;
    replica.lastProofHash = proofHash;
    replica.availability = 'available';
    this.recompute(record);
    return this.status(namespace, hash);
  }

  status(namespace, hash) {
    this.expire();
    const record = this.getRecord(namespace, hash);
    this.recompute(record);
    return {
      namespace: record.namespace, hash: record.hash, status: record.status,
      durableReplicaCount: [...record.replicas.values()].filter(r =>
        r.state === 'restart_recovery_verified' && r.availability === 'available' &&
        this.peers.get(r.peerId)?.available === true &&
        this.peers.get(r.peerId)?.sessionId === r.recoverySessionId
      ).length,
      replicas: [...record.replicas.values()].map(r => ({ ...r }))
    };
  }

  peerStatus(peerId) {
    this.expire();
    const peer = this.peers.get(peerId);
    if (!peer) return null;
    return { ...peer, appIds: [...peer.appIds], advertisedCapacityBytes: peer.capacityBytes,
      durableCapacityBytes: 0, available: peer.available && peer.leaseExpiresAt > this.now() };
  }

  route(namespace, hash) {
    this.expire();
    if (!APP_IDS.has(namespace) || !HASH_RE.test(String(hash))) throw new TypeError('invalid namespace or content address');
    const record = this.payloads.get(namespace + ':' + hash);
    if (!record) throw new Error('payload has no registered replica');
    const candidates = [...record.replicas.values()].filter(r => {
      const peer = this.peers.get(r.peerId);
      return r.availability === 'available' && peer?.available && peer.leaseExpiresAt > this.now() &&
        peer.sessionId === r.recoverySessionId && r.state === 'restart_recovery_verified' &&
        peer.appIds.includes(namespace);
    });
    if (!candidates.length) throw new Error('payload unavailable: no live recovery-verified storage peer');
    return { peerId: candidates[0].peerId, namespace, hash, state: 'restart_recovery_verified' };
  }

  getRecord(namespace, hash) {
    if (!APP_IDS.has(namespace) || typeof hash !== 'string' || !HASH_RE.test(hash)) throw new TypeError('invalid namespace or content address');
    const record = this.payloads.get(namespace + ':' + hash);
    if (!record) throw new Error('unknown payload');
    return record;
  }

  getReplica(record, peerId, sessionId) {
    peerId = required(peerId, 'peerId');
    sessionId = required(sessionId, 'sessionId');
    const replica = record.replicas.get(peerId);
    if (!replica || replica.sessionId !== sessionId) throw new Error('receipt peer/session does not match write session');
    const peer = this.peers.get(peerId);
    if (!peer || peer.sessionId !== sessionId) throw new Error('receipt arrived from stale peer session');
    return replica;
  }

  recompute(record) {
    const verified = [...record.replicas.values()].some(r => {
      const peer = this.peers.get(r.peerId);
      return r.state === 'restart_recovery_verified' && r.availability === 'available' &&
        peer?.available === true && peer.sessionId === r.recoverySessionId && peer.leaseExpiresAt > this.now();
    });
    record.status = verified ? 'recovery_verified' :
      ([...record.replicas.values()].some(r => r.availability === 'unavailable') ? 'unavailable' : 'volatile');
  }
}
