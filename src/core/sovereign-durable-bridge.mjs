import { randomUUID } from 'node:crypto';

const DEFAULT_MAX_ATTEMPTS = Number(process.env.APEX_SOVEREIGN_MAX_ATTEMPTS || 8);

function requireDb(db) {
  if (!db || typeof db.query !== 'function') {
    throw new TypeError('Sovereign durable bridge requires a PostgreSQL client');
  }
}

function serializePayload(record) {
  return JSON.stringify({
    source: 'sovereign-wal',
    seq: record.seq,
    waveId: record.waveId,
    peerId: record.peerId,
    action: record.action,
    timestamp: record.timestamp,
    payload: record.payload,
    checksum: record.checksum
  });
}

export function createSovereignDurableBridge({ engine, db, workerId, peerNode, peerAddress, sendPeer }) {
  if (!engine) throw new TypeError('engine is required');
  if (!workerId) throw new Error('workerId is required');
  requireDb(db);

  async function persist(record, options = {}) {
    const now = options.now ?? new Date();
    const id = randomUUID();
    const dedupeKey = `sovereign:${record.waveId}`;

    const inserted = await db.query(
      `INSERT INTO durable_jobs
        (id, type, payload, status, run_at, max_attempts, dedupe_key, created_at, updated_at)
       VALUES
        ($1, $2, $3::jsonb, 'queued', $4, $5, $6, $4, $4)
       ON CONFLICT (dedupe_key)
       WHERE dedupe_key IS NOT NULL AND status IN ('queued','running')
       DO NOTHING
       RETURNING id, status, attempts, max_attempts, dedupe_key, lease_fence`,
      [
        id,
        options.type ?? 'sovereign.publish',
        serializePayload(record),
        now,
        options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        dedupeKey
      ]
    );

    if (inserted.rows[0]) return inserted.rows[0];

    const existing = await db.query(
      `SELECT id, status, attempts, max_attempts, dedupe_key, lease_fence
       FROM durable_jobs
       WHERE dedupe_key = $1 AND status IN ('queued','running')
       LIMIT 1`,
      [dedupeKey]
    );

    if (!existing.rows[0]) {
      throw new Error(`Durable task disappeared during idempotent insert: ${dedupeKey}`);
    }

    return existing.rows[0];
  }

  async function dispatch(payload, options = {}) {
    const record = await engine.dispatchAutonomousPayload(payload);
    const job = await persist(record, options);
    let peerAcceptance = null;
    const requirePeer = process.env.APEX_REQUIRE_PEER_ACK === 'true';
    if (requirePeer && !(peerNode && peerAddress && sendPeer)) {
      throw new Error('peer acknowledgement is required but no peer transport is configured');
    }
    if (peerNode && peerAddress && sendPeer) {
      peerAcceptance = await sendPeer(peerNode, peerAddress, {
        type: 'durable.accept',
        waveId: record.waveId,
        jobId: job.id,
        checksum: record.checksum,
        fence: Number(job.lease_fence ?? 0)
      });
    }

    const acknowledged = await engine.acknowledge(record.waveId, {
      database: 'accepted',
      jobId: job.id,
      status: job.status,
      peer: peerAcceptance
    });
    return { record, job, acknowledged };
  }

  async function reconcile(options = {}) {
    const records = engine.snapshot().filter((record) => record.status === 'DISPATCHED');
    const results = [];
    const errors = [];

    for (const record of records) {
      try {
        const job = await persist(record, options);
        let peerAcceptance = null;
        const requirePeer = process.env.APEX_REQUIRE_PEER_ACK === 'true';
        if (requirePeer && !(peerNode && peerAddress && sendPeer)) {
          throw new Error('peer acknowledgement is required but no peer transport is configured');
        }
        if (peerNode && peerAddress && sendPeer) {
          peerAcceptance = await sendPeer(peerNode, peerAddress, {
            type: 'durable.accept',
            waveId: record.waveId,
            jobId: job.id,
            checksum: record.checksum,
            fence: Number(job.lease_fence ?? 0)
          });
        }

        const acknowledged = await engine.acknowledge(record.waveId, {
          database: 'accepted',
          jobId: job.id,
          status: job.status,
          peer: peerAcceptance
        });
        results.push({
          waveId: record.waveId,
          jobId: job.id,
          status: job.status,
          acknowledged: acknowledged.status === 'ACKNOWLEDGED'
        });
      } catch (error) {
        errors.push({
          waveId: record.waveId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return {
      workerId,
      scanned: records.length,
      persisted: results.length,
      failed: errors.length,
      results,
      errors
    };
  }

  return { dispatch, persist, reconcile, workerId };
}

export default createSovereignDurableBridge;
