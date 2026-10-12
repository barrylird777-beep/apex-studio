import { randomUUID } from 'node:crypto';
import { apexPureStore } from './apex-pure-store.mjs';

const DEFAULT_MAX_ATTEMPTS = Number(process.env.APEX_SOVEREIGN_MAX_ATTEMPTS || 8);

function serializePayload(record) {
  return {
    source: 'sovereign-wal',
    seq: record.seq,
    waveId: record.waveId,
    peerId: record.peerId,
    action: record.action,
    timestamp: record.timestamp,
    payload: record.payload,
    status: record.status,
    checksum: record.checksum
  };
}

/**
 * Connects the checksummed sovereign event log to the local durable job store.
 * PostgreSQL is deliberately not required by this bridge.
 */
export function createSovereignDurableBridge({ engine, workerId, peerNode, peerAddress, sendPeer, store = apexPureStore }) {
  if (!engine) throw new TypeError('engine is required');
  if (!workerId) throw new Error('workerId is required');
  if (!store || typeof store.enqueue !== 'function') throw new TypeError('a durable local store is required');

  async function persist(record, options = {}) {
    const payload = serializePayload(record);
    const result = await store.enqueue({
      id: randomUUID(),
      type: options.type ?? 'sovereign.publish',
      payload,
      runAt: options.now instanceof Date ? options.now.getTime() : (options.now ?? Date.now()),
      maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      dedupeKey: `sovereign:${record.waveId}`
    });
    const job = (typeof store.jobs === 'function' ? store.jobs() : []).find((item) => item.id === String(result.id));
    return job || { id: String(result.id), status: result.duplicate ? 'existing' : 'queued', leaseFence: 0, duplicate: Boolean(result.duplicate) };
  }

  async function acceptRecord(record, options = {}) {
    const job = await persist(record, options);
    let peerAcceptance = null;
    const requirePeer = process.env.APEX_REQUIRE_PEER_ACK !== 'false';
    if (requirePeer && !(peerNode && peerAddress && sendPeer)) {
      throw new Error('peer acknowledgement is required but no peer transport is configured');
    }
    if (peerNode && peerAddress && sendPeer) {
      peerAcceptance = await sendPeer(peerNode, peerAddress, {
        type: 'durable.accept',
        waveId: record.waveId,
        jobId: job.id,
        checksum: record.checksum,
        record,
        fence: Number(job.leaseFence ?? job.lease_fence ?? 0)
      });
    }
    const acknowledged = await engine.acknowledge(record.waveId, {
      storage: 'accepted',
      jobId: job.id,
      status: job.status,
      peer: peerAcceptance
    });
    if (peerAcceptance) {
      await store.put('sovereign_peer_acks', record.waveId, {
        waveId: record.waveId,
        peerId: String(peerAcceptance.peerId || peerAddress || ''),
        checksum: record.checksum,
        acknowledgedAt: new Date().toISOString()
      });
    }
    return { record, job, acknowledged };
  }

  async function dispatch(payload, options = {}) {
    const record = await engine.dispatchAutonomousPayload(payload);
    return acceptRecord(record, options);
  }

  async function reconcile(options = {}) {
    const records = engine.snapshot().filter((record) => record.status === 'DISPATCHED');
    const results = [];
    const errors = [];
    let acknowledgedCount = 0;
    for (const record of records) {
      try {
        const result = await acceptRecord(record, options);
        const didAck = result.acknowledged.status === 'ACKNOWLEDGED';
        if (didAck) acknowledgedCount += 1;
        results.push({ waveId: record.waveId, jobId: result.job.id, status: result.job.status, acknowledged: didAck });
      } catch (error) {
        errors.push({ waveId: record.waveId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { workerId, scanned: records.length, persisted: results.length, acknowledged: acknowledgedCount, failed: errors.length, results, errors };
  }

  return { dispatch, persist, reconcile, workerId };
}

export default createSovereignDurableBridge;
