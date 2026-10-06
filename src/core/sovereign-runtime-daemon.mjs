import os from 'node:os';
import pg from 'pg';
import SovereignMeshEngine from './sovereign-mesh-engine.mjs';
import { createSovereignDurableBridge } from './sovereign-durable-bridge.mjs';
import { createSovereignPeer, sendToPeer } from '../network/sovereign-peer.mjs';

const { Pool } = pg;
const storageDir = process.env.APEX_SOVEREIGN_STORAGE_DIR || '/srv/apex/se-x/projects';
const workerId = process.env.APEX_SOVEREIGN_WORKER_ID || `sovereign-${os.hostname()}-${process.pid}`;
const reconcileMs = Math.max(1000, Number(process.env.APEX_SOVEREIGN_RECONCILE_MS || 10000));
const peerAddress = process.env.APEX_SOVEREIGN_PEER_ADDRESS || '';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.APEX_PG_POOL_SIZE || 20),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: process.env.APEX_PG_SSL === 'false' ? false : { rejectUnauthorized: false }
});

const engine = new SovereignMeshEngine(storageDir);
let peerNode;
let stopping = false;
let timer;

async function acceptPeerEnvelope(envelope) {
  if (!envelope || envelope.type !== 'durable.accept') throw new Error('unsupported sovereign envelope');
  if (!envelope.waveId || !envelope.jobId || !envelope.checksum) throw new Error('incomplete sovereign envelope');
  if (!/^[0-9a-f]{64}$/i.test(envelope.checksum)) throw new Error('invalid sovereign checksum');
  if (!/^[0-9a-f-]{36}$/i.test(envelope.jobId)) throw new Error('invalid sovereign job id');

  const result = await pool.query(
    `INSERT INTO durable_job_receipts
      (wave_id, origin_job_id, checksum, origin_fence)
     VALUES ($1, $2::uuid, $3, $4)
     ON CONFLICT (wave_id) DO UPDATE
       SET checksum = EXCLUDED.checksum,
           origin_job_id = EXCLUDED.origin_job_id,
           origin_fence = GREATEST(durable_job_receipts.origin_fence, EXCLUDED.origin_fence)
     RETURNING wave_id`,
    [envelope.waveId, envelope.jobId, envelope.checksum, Number(envelope.fence || 0)]
  );
  if (result.rowCount !== 1) throw new Error('peer receipt was not durable');
  return true;
}

async function main() {
  await pool.query('SELECT 1');

  peerNode = await createSovereignPeer({ onEnvelope: acceptPeerEnvelope });
  await peerNode.start();
  process.env.APEX_SOVEREIGN_PEER_ID = peerNode.peerId.toString();

  const bridge = createSovereignDurableBridge({
    engine,
    db: pool,
    workerId,
    peerNode,
    peerAddress,
    sendPeer: sendToPeer
  });

  await reconcile(bridge);

  console.log('[*] APEX STUDIO SOVEREIGN RUNTIME ONLINE', JSON.stringify({
    workerId,
    peerId: peerNode.peerId.toString(),
    peerAddress: peerAddress || null,
    listenAddresses: peerNode.getMultiaddrs().map(String),
    storageDir: engine.storageDir,
    walFilePath: engine.walFilePath,
    reconcileMs
  }));

  timer = setInterval(() => {
    if (!stopping) reconcile(bridge).catch((error) => console.error('[SOVEREIGN] reconcile failed', error));
  }, reconcileMs);
  timer.unref?.();
}

async function reconcile(bridge) {
  const result = await bridge.reconcile();
  console.log('[SOVEREIGN RECONCILE]', JSON.stringify({
    scanned: result.scanned,
    persisted: result.persisted,
    failed: result.failed
  }));
  for (const error of result.errors || []) console.error('[SOVEREIGN RECONCILE ERROR]', JSON.stringify(error));
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  if (timer) clearInterval(timer);
  console.log(`[SOVEREIGN] draining on ${signal}`);

  try {
    const bridge = createSovereignDurableBridge({
      engine, db: pool, workerId, peerNode, peerAddress, sendPeer: sendToPeer
    });
    await reconcile(bridge);
  } catch (error) {
    console.error('[SOVEREIGN] final reconcile failed:', error);
    process.exitCode = 1;
  } finally {
    await peerNode?.stop().catch(() => {});
    await pool.end().catch(() => {});
  }
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

main().catch(async (error) => {
  console.error('[FATAL] Sovereign runtime failed:', error);
  await peerNode?.stop().catch(() => {});
  await pool.end().catch(() => {});
  process.exitCode = 1;
});
