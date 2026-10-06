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

  await pool.query(
    `INSERT INTO durable_jobs
      (id, type, payload, status, run_at, max_attempts, dedupe_key, created_at, updated_at)
     VALUES ($1, 'sovereign.peer.accept', $2::jsonb, 'queued', NOW(), 1, $3, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [
      envelope.jobId,
      JSON.stringify({
        source: 'sovereign-peer',
        waveId: envelope.waveId,
        checksum: envelope.checksum,
        fence: envelope.fence
      }),
      `peer:${envelope.waveId}`
    ]
  );
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
