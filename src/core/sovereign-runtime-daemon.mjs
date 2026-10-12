import os from 'node:os';
import { createHash } from 'node:crypto';
import SovereignMeshEngine, { verifySovereignRecord } from './sovereign-mesh-engine.mjs';
import { apexPureStore } from './apex-pure-store.mjs';
import { createSovereignDurableBridge } from './sovereign-durable-bridge.mjs';
import { createSovereignPeer, sendToPeer } from '../network/sovereign-peer.mjs';
import { createApexEdgeNode } from '../network/apex-edge-node.mjs';
import { drainSovereignAppDispatchQueue } from './sovereign-app-dispatch-queue.mjs';
import { sovereignAppFabric } from './sovereign-app-fabric.mjs';

const storageDir = process.env.APEX_SOVEREIGN_STORAGE_DIR || '/srv/apex/se-x/projects';
const workerId = process.env.APEX_SOVEREIGN_WORKER_ID || `sovereign-${os.hostname()}-${process.pid}`;
const reconcileMs = Math.max(1000, Number(process.env.APEX_SOVEREIGN_RECONCILE_MS || 10000));
const peerAddress = process.env.APEX_SOVEREIGN_PEER_ADDRESS || '';

const engine = new SovereignMeshEngine(storageDir);
let peerNode;
let edgeNode;
let stopping = false;
let timer;
let bridge;

async function acceptPeerEnvelope(envelope, { remotePeerId = '' } = {}) {
  if (!envelope || !['durable.accept', 'edge.heartbeat'].includes(envelope.type)) {
    throw new Error('unsupported sovereign envelope');
  }
  if (envelope.type === 'edge.heartbeat') return true;
  if (!remotePeerId) throw new Error('authenticated remote peer identity missing');
  if (!envelope.waveId || !envelope.jobId || !envelope.checksum || !envelope.record) throw new Error('incomplete sovereign envelope');
  if (!/^[0-9a-f]{64}$/i.test(envelope.checksum)) throw new Error('invalid sovereign checksum');
  if (!/^[0-9a-f-]{36}$/i.test(envelope.jobId)) throw new Error('invalid sovereign job id');
  if (!verifySovereignRecord(envelope.record)) throw new Error('peer event checksum verification failed');
  if (envelope.record.waveId !== envelope.waveId || envelope.record.checksum !== envelope.checksum || envelope.record.status !== 'DISPATCHED') {
    throw new Error('peer event envelope does not match its verified record');
  }

  const receiptId = String(envelope.waveId);
  const existing = await apexPureStore.get('sovereign_peer_receipts', receiptId);
  if (existing && existing.checksum !== envelope.checksum) {
    throw new Error('conflicting peer receipt checksum for wave');
  }

  const record = envelope.record;
  const appId = String(record.payload?.appId || '');
  if (appId) {
    const recordId = 'peer-' + createHash('sha256').update(receiptId).digest('hex');
    await sovereignAppFabric.put(appId, recordId, {
      waveId: receiptId,
      action: String(record.action || 'app.publish'),
      data: record.payload?.data ?? record.payload,
      sourcePeerId: remotePeerId,
      originPeerId: record.peerId,
      sourceChecksum: envelope.checksum,
      receivedAt: existing?.receivedAt || new Date().toISOString()
    });
  }

  if (!existing) {
    await apexPureStore.put('sovereign_peer_receipts', receiptId, {
      waveId: receiptId,
      originPeerId: String(record.peerId),
      transportPeerId: remotePeerId,
      originJobId: String(envelope.jobId),
      checksum: envelope.checksum,
      originFence: Math.max(0, Number(envelope.fence || 0)),
      receivedAt: new Date().toISOString()
    });
  }

  const localWaveId = 'peer-' + createHash('sha256').update(remotePeerId + ':' + receiptId).digest('hex');
  await engine.dispatchAutonomousPayload({
    waveId: localWaveId,
    peerId: remotePeerId,
    action: 'PeerReceive',
    payload: { originWaveId: receiptId, sourcePeerId: remotePeerId, sourceChecksum: envelope.checksum }
  });
  return true;
}

async function main() {
  await apexPureStore.init();
  await engine.ready();

  peerNode = await createSovereignPeer({ onEnvelope: acceptPeerEnvelope });
  await peerNode.start();
  process.env.APEX_SOVEREIGN_PEER_ID = peerNode.peerId.toString();
  await publishRuntimeIdentity('online');

  edgeNode = await createApexEdgeNode({
    peerNode,
    onState: (state) => console.log('[EDGE STATE]', JSON.stringify({
      selected: state.network?.selected,
      mptcp: state.mptcp,
      error: state.error
    }))
  });

  bridge = createSovereignDurableBridge({
    engine,
    store: apexPureStore,
    workerId,
    peerNode,
    peerAddress,
    sendPeer: sendToPeer
  });

  await runCycle(bridge);
  console.log('[*] APEX SOVEREIGN RUNTIME ONLINE', JSON.stringify({
    workerId,
    peerId: peerNode.peerId.toString(),
    peerAddress: peerAddress || null,
    listenAddresses: peerNode.getMultiaddrs().map(String),
    storageDir: engine.storageDir,
    walFilePath: engine.walFilePath,
    durableStore: 'local-pure-wal',
    reconcileMs
  }));

  timer = setInterval(() => {
    if (!stopping) runCycle(bridge).catch((error) => console.error('[SOVEREIGN] cycle failed', error));
  }, reconcileMs);
  timer.unref?.();
}

async function publishRuntimeIdentity(status = 'online') {
  if (!peerNode) return;
  const now = Date.now();
  const peerId = peerNode.peerId.toString();
  const publicHost = String(process.env.APEX_P2P_PUBLIC_HOST || '').trim();
  const publicPort = Number(process.env.APEX_P2P_PUBLIC_PORT || 0);
  const publicPeerAddress = publicHost && /^[A-Za-z0-9.-]+$/.test(publicHost) && Number.isInteger(publicPort) && publicPort > 0 && publicPort <= 65535
    ? `/dns4/${publicHost}/tcp/${publicPort}/p2p/${peerId}`
    : null;
  await apexPureStore.put('sovereign_runtime', 'identity', {
    status,
    peerId,
    publicPeerAddress,
    workerId,
    listenAddresses: peerNode.getMultiaddrs().map(String),
    lastSeenAt: new Date(now).toISOString(),
    pendingPeerAcks: engine.snapshot().filter(record => record.status === 'DISPATCHED').length,
    leaseExpiresAt: status === 'online' ? now + Math.max(30000, reconcileMs * 3) : 0
  });
}

async function runCycle(activeBridge) {
  await publishRuntimeIdentity('online');
  const queued = await drainSovereignAppDispatchQueue({
    store: apexPureStore,
    engine,
    peerId: peerNode.peerId.toString(),
    workerId,
    limit: 32,
    leaseMs: Math.max(15000, reconcileMs * 3)
  });
  if (queued.claimed) console.log('[SOVEREIGN APP DISPATCH]', JSON.stringify(queued));
  await reconcile(activeBridge);
  await publishRuntimeIdentity('online');
}

async function reconcile(activeBridge) {
  const result = await activeBridge.reconcile();
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
    if (bridge) await reconcile(bridge);
  } catch (error) {
    console.error('[SOVEREIGN] final reconcile failed:', error);
    process.exitCode = 1;
  } finally {
    await publishRuntimeIdentity('offline').catch(() => {});
    await edgeNode?.stop().catch(() => {});
    await peerNode?.stop().catch(() => {});
  }
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

main().catch(async (error) => {
  console.error('[FATAL] Sovereign runtime failed:', error);
  await edgeNode?.stop().catch(() => {});
  await peerNode?.stop().catch(() => {});
  process.exitCode = 1;
});
