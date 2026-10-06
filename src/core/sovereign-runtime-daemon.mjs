import os from 'node:os';
import pg from 'pg';
import SovereignMeshEngine from './sovereign-mesh-engine.mjs';
import { createSovereignDurableBridge } from './sovereign-durable-bridge.mjs';

const { Pool } = pg;

const storageDir =
  process.env.APEX_SOVEREIGN_STORAGE_DIR || '/srv/apex/se-x/projects';
const workerId =
  process.env.APEX_SOVEREIGN_WORKER_ID || `sovereign-${os.hostname()}-${process.pid}`;
const reconcileMs = Math.max(
  1000,
  Number(process.env.APEX_SOVEREIGN_RECONCILE_MS || 10000)
);

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the sovereign runtime');
}
if (!process.env.APEX_SOVEREIGN_PEER_ID) {
  throw new Error('APEX_SOVEREIGN_PEER_ID is required for the sovereign runtime');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.APEX_PG_POOL_SIZE || 20),
  idleTimeoutMillis: Number(process.env.APEX_PG_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.APEX_PG_CONNECT_TIMEOUT_MS || 10000),
  ssl: process.env.APEX_PG_SSL === 'false'
    ? false
    : { rejectUnauthorized: false }
});

const engine = new SovereignMeshEngine(storageDir);
const bridgePromise = engine.ready().then(() =>
  createSovereignDurableBridge({ engine, db: pool, workerId })
);

let stopping = false;
let timer;

async function reconcile(bridge) {
  const result = await bridge.reconcile();
  console.log(
    '[SOVEREIGN RECONCILE]',
    JSON.stringify({
      scanned: result.scanned,
      persisted: result.persisted,
      failed: result.failed
    })
  );

  if (result.failed) {
    for (const error of result.errors) {
      console.error('[SOVEREIGN RECONCILE ERROR]', JSON.stringify(error));
    }
  }
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  if (timer) clearInterval(timer);

  console.log(`[SOVEREIGN] draining on ${signal}`);

  try {
    const bridge = await bridgePromise;
    await reconcile(bridge);
  } catch (error) {
    console.error('[SOVEREIGN] final reconcile failed:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

async function main() {
  const bridge = await bridgePromise;

  await pool.query('SELECT 1');
  await reconcile(bridge);

  console.log(
    '[*] APEX STUDIO SOVEREIGN RUNTIME ONLINE',
    JSON.stringify({
      workerId,
      storageDir: engine.storageDir,
      walFilePath: engine.walFilePath,
      reconcileMs
    })
  );

  timer = setInterval(() => {
    if (stopping) return;
    reconcile(bridge).catch((error) => {
      console.error('[SOVEREIGN] reconcile cycle failed:', error);
    });
  }, reconcileMs);

  timer.unref?.();
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

main().catch(async (error) => {
  console.error('[FATAL] Sovereign runtime failed:', error);
  await pool.end().catch(() => {});
  process.exitCode = 1;
});
