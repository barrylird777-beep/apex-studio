import pg from 'pg';
import { randomUUID } from 'node:crypto';
import SovereignMeshEngine from '../src/core/sovereign-mesh-engine.mjs';
import { createSovereignDurableBridge } from '../src/core/sovereign-durable-bridge.mjs';
import { swarmPeers, pinCid } from '../src/network/ipfs-swarm.mjs';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  connectionTimeoutMillis: 10000,
  ssl: process.env.APEX_PG_SSL === 'false' ? false : { rejectUnauthorized: false }
});
const engine = new SovereignMeshEngine(process.env.APEX_SOVEREIGN_STORAGE_DIR || '/srv/apex/se-x/projects');
await engine.ready();

const workerId = process.env.APEX_SOVEREIGN_WORKER_ID || `smoke-${process.pid}`;
const bridge = createSovereignDurableBridge({ engine, db: pool, workerId });
const waveId = randomUUID();

try {
  await pool.query('SELECT 1');
  const result = await bridge.dispatch({
    waveId,
    peerId: process.env.APEX_SOVEREIGN_PEER_ID || `smoke-${process.pid}`,
    action: 'render.dispatch',
    payload: {
      kind: 'render-test',
      resolutions: [720, 1080, 1440],
      audio: 'voiceover',
      createdAt: new Date().toISOString()
    }
  });

  const cid = process.env.APEX_SMOKE_CID;
  const ipfs = cid ? await pinCid(cid) : { skipped: true, reason: 'APEX_SMOKE_CID not set' };

  console.log(JSON.stringify({
    ok: true,
    waveId,
    jobId: result.job.id,
    walStatus: result.acknowledged.status,
    ipfsPeers: await swarmPeers(),
    ipfs
  }, null, 2));
} finally {
  await pool.end();
}
