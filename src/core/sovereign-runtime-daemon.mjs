import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { verifyRemoteWalProbe } from './runtime-readiness.mjs';
import SovereignMeshEngine, { verifySovereignRecord } from './sovereign-mesh-engine.mjs';
import { apexPureStore } from './apex-pure-store.mjs';
import { createSovereignDurableBridge } from './sovereign-durable-bridge.mjs';
import { createSovereignPeer, sendToPeer } from '../network/sovereign-peer.mjs';
import { createApexEdgeNode } from '../network/apex-edge-node.mjs';
import { drainSovereignAppDispatchQueue } from './sovereign-app-dispatch-queue.mjs';
import { sovereignAppFabric } from './sovereign-app-fabric.mjs';
import { retryWalStartup } from './wal-startup-retry.mjs';
import { buildPublicPeerAddress } from '../network/public-peer-address.mjs';
import { acknowledgeLocalPeerReceive, acknowledgePendingLocalPeerReceives } from './sovereign-peer-receipts.mjs';
import { readSovereignPeerReplica } from './sovereign-peer-replica.mjs';
import { migrateSovereignStorage } from './sovereign-storage-migration.mjs';

const storageMigration = await migrateSovereignStorage();
console.log('[SOVEREIGN STORAGE] persistent root ready', JSON.stringify({ migrated: storageMigration.migrated, copiedFiles: storageMigration.copied.length }));
const storageDir = process.env.APEX_SOVEREIGN_STORAGE_DIR || '/srv/apex/se-x/projects';
const workerId = process.env.APEX_SOVEREIGN_WORKER_ID || `sovereign-${os.hostname()}-${process.pid}`;
const reconcileMs = Math.max(1000, Number(process.env.APEX_SOVEREIGN_RECONCILE_MS || 10000));
const peerAddress = process.env.APEX_SOVEREIGN_PEER_ADDRESS || '';
const smokeTestWaveId = String(process.env.APEX_PEER_SMOKE_TEST_WAVE_ID || '').trim();

const engine = new SovereignMeshEngine(storageDir);
let peerNode;
let edgeNode;
let stopping = false;
let timer;
let bridge;
const runtimeReadiness = { storageReady: false, peerReady: false, remoteWalVerified: false, remoteWalSequence: null, remoteWalHash: null, dispatchReady: false };

async function acceptPeerEnvelope(envelope, { remotePeerId = '' } = {}) {
  if (!envelope || !['durable.accept', 'durable.read', 'edge.heartbeat'].includes(envelope.type)) {
    throw new Error('unsupported sovereign envelope');
  }
  if (envelope.type === 'edge.heartbeat') return true;
  if (!remotePeerId) throw new Error('authenticated remote peer identity missing');
  if (envelope.type === 'durable.read') {
    return { accepted: true, replica: readSovereignPeerReplica(engine, envelope, { remotePeerId }) };
  }
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

  console.log('[SOVEREIGN PEER RECEIPT]', JSON.stringify({ waveId: receiptId, checksum: envelope.checksum, durable: true, duplicate: Boolean(existing) }));

  const localWaveId = 'peer-' + createHash('sha256').update(remotePeerId + ':' + receiptId).digest('hex');
  await engine.dispatchAutonomousPayload({
    waveId: localWaveId,
    peerId: remotePeerId,
    action: 'PeerReceive',
    payload: {
      originWaveId: receiptId,
      sourcePeerId: remotePeerId,
      sourceChecksum: envelope.checksum,
      // Persist the verified source record inside this peer's own content-addressed history.
      // A receipt alone proves arrival, not that the actual event can be recovered here.
      sourceRecord: record
    }
  });
  await acknowledgeLocalPeerReceive(engine, localWaveId, remotePeerId);
  return true;
}

async function verifyRemoteWalReadiness() {
  if (!apexPureStore.remoteMode || apexPureStore.wal?.constructor?.name !== 'RemoteApexRingWAL') {
    runtimeReadiness.remoteWalVerified = false;
    return false;
  }
  const record = await apexPureStore.wal.append('runtime.readiness.probe', {
    version: 1,
    nonce: randomUUID(),
    peerId: peerNode?.peerId?.toString() || null,
    checkedAt: new Date().toISOString()
  });
  const snapshot = await apexPureStore.wal.snapshot();
  if (!verifyRemoteWalProbe(record, snapshot)) {
    throw new Error('RemoteApexRingWAL readiness append/readback/hash-chain verification failed');
  }
  runtimeReadiness.remoteWalVerified = true;
  runtimeReadiness.remoteWalSequence = record.seq;
  runtimeReadiness.remoteWalHash = record.hash;
  return true;
}

async function main() {
  const storageReady = await retryWalStartup(() => apexPureStore.init(), { isStopping: () => stopping });
  if (!storageReady) return;
  runtimeReadiness.storageReady = true;
  await engine.ready();
  const settledLocalReceipts = await acknowledgePendingLocalPeerReceives(engine);
  if (settledLocalReceipts) console.log('[SOVEREIGN LOCAL RECEIPTS]', JSON.stringify({ acknowledged: settledLocalReceipts, disposition: 'local-only' }));

  peerNode = await createSovereignPeer({ onEnvelope: acceptPeerEnvelope });
  await peerNode.start();
  const peerAddresses = peerNode.getMultiaddrs?.() || [];
  const peerStarted = typeof peerNode.isStarted === 'function' ? peerNode.isStarted() : false;
  runtimeReadiness.peerReady = peerStarted === true && peerAddresses.length > 0;
  if (!runtimeReadiness.peerReady) {
    throw new Error('libp2p peer did not report started state with at least one listen address');
  }
  process.env.APEX_SOVEREIGN_PEER_ID = peerNode.peerId.toString();
  try {
    await verifyRemoteWalReadiness();
  } catch (error) {
    runtimeReadiness.remoteWalVerified = false;
    console.error('[SOVEREIGN READINESS] remote WAL probe failed; readiness remains closed', String(error?.message || error));
  }
  await publishRuntimeIdentity('starting');

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

  if (smokeTestWaveId) {
    const existingSmokeRecord = engine.get(smokeTestWaveId);
    if (!existingSmokeRecord) {
      const smokeRecord = await engine.dispatchAutonomousPayload({
        waveId: smokeTestWaveId,
        peerId: peerNode.peerId.toString(),
        action: 'apex.production.mesh-smoke-test',
        payload: { marker: 'APEX_ANCHOR_PRODUCTION_SMOKE_TEST', source: 'apex-studio', createdAt: new Date().toISOString() }
      });
      console.log('[SOVEREIGN SMOKE TEST] queued', JSON.stringify({ waveId: smokeRecord.waveId, checksum: smokeRecord.checksum }));
    } else {
      console.log('[SOVEREIGN SMOKE TEST] already present', JSON.stringify({ waveId: smokeTestWaveId, status: existingSmokeRecord.status }));
    }
  }

  await runCycle(bridge);
  runtimeReadiness.dispatchReady = true;
  await publishRuntimeIdentity('online');
  const readinessReady = runtimeReadiness.storageReady && runtimeReadiness.peerReady && runtimeReadiness.remoteWalVerified && runtimeReadiness.dispatchReady;
  console.log('[*] APEX SOVEREIGN RUNTIME STARTED', JSON.stringify({
    status: readinessReady ? 'online' : 'starting',
    readiness: { ...runtimeReadiness, ready: readinessReady },
    workerId,
    peerId: peerNode.peerId.toString(),
    peerAddress: peerAddress || null,
    publicPeerAddress: buildPublicPeerAddress(peerNode.peerId.toString()),
    listenAddresses: peerNode.getMultiaddrs().map(String),
    storageDir: engine.storageDir,
    durableStore: 'content-addressed',
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
  const publicPeerAddress = buildPublicPeerAddress(peerId);
  const readiness = {
    ...runtimeReadiness,
    ready: runtimeReadiness.storageReady && runtimeReadiness.peerReady && runtimeReadiness.remoteWalVerified && runtimeReadiness.dispatchReady
  };
  const effectiveStatus = status === 'offline' ? 'offline' : readiness.ready ? 'online' : 'starting';
  await apexPureStore.put('sovereign_runtime', 'identity', {
    status: effectiveStatus,
    instanceId: process.env.APEX_RUNTIME_INSTANCE_ID || null,
    readiness,
    peerId,
    publicPeerAddress,
    workerId,
    listenAddresses: peerNode.getMultiaddrs().map(String),
    lastSeenAt: new Date(now).toISOString(),
    pendingPeerAcks: engine.snapshot().filter(record => record.status === 'DISPATCHED').length,
    leaseExpiresAt: effectiveStatus === 'online' ? now + Math.max(30000, reconcileMs * 3) : 0
  });
}

async function runCycle(activeBridge) {
  if (!runtimeReadiness.remoteWalVerified) {
    try {
      await verifyRemoteWalReadiness();
    } catch (error) {
      console.error('[SOVEREIGN READINESS] remote WAL retry failed; readiness remains closed', String(error?.message || error));
    }
  }
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
    acknowledged: result.acknowledged,
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
