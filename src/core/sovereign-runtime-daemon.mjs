import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { verifyRemotePersistenceProbe } from './runtime-readiness.mjs';
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
import { initializePeerObjectStorage } from './peer-storage-runtime.mjs';
import { startPeerCasRuntime } from './peer-cas-runtime.mjs';

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
let cyclePromise = Promise.resolve();
let cycleFailed = false;
let bridge;
let modelBridge;
let peerStorageRuntime = { enabled: false, handle: async () => { throw new Error('peer object storage is disabled'); } };
let peerStorageStore;
const runtimeReadiness = { storageReady: false, peerReady: false, remotePersistenceVerified: false, remotePersistenceHash: null, peerStorageVerified: false, dispatchReady: false };

async function acceptPeerEnvelope(envelope, { remotePeerId = '' } = {}) {
  if (envelope?.protocol === 'apex.cas.v1') {
    if (!peerStorageRuntime.enabled) throw new Error('peer object storage is disabled');
    return peerStorageRuntime.handle(envelope, { remotePeerId });
  }
  if (!envelope || !['durable.accept', 'durable.read', 'edge.heartbeat'].includes(envelope.type)) {
    throw new Error('unsupported sovereign envelope');
  }
  if (envelope.type === 'edge.heartbeat') return true;
  if (!runtimeReadiness.peerStorageVerified) throw new Error('peer-owned storage is not verified; refusing work before sovereign storage readiness');
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

async function verifyRemotePersistenceReadiness() {
  if (!apexPureStore.remoteMode || !apexPureStore.cas?.writeRef || !apexPureStore.cas?.readRef || !apexPureStore.cas?.deleteRef) {
    runtimeReadiness.remotePersistenceVerified = false;
    return false;
  }
  const key = 'runtime-probe-' + randomUUID();
  const probe = { version: 1, nonce: randomUUID(), peerId: peerNode?.peerId?.toString() || null, checkedAt: new Date().toISOString() };
  const written = await apexPureStore.cas.writeRef('system', key, probe, { expectedHash: null });
  const readback = await apexPureStore.cas.readRef('system', key);
  if (!verifyRemotePersistenceProbe(probe, readback) || written?.hash !== readback?.hash) {
    throw new Error('Remote CAS readiness write/read/hash verification failed');
  }
  await apexPureStore.cas.deleteRef('system', key, { expectedHash: readback.hash });
  runtimeReadiness.remotePersistenceVerified = true;
  runtimeReadiness.remotePersistenceHash = readback.hash;
  return true;
}

async function main() {
  const storageReady = await retryWalStartup(() => apexPureStore.init(), { isStopping: () => stopping });
  if (!storageReady || stopping) return;
  runtimeReadiness.storageReady = true;
  await engine.ready();
  if (stopping) return;
  const settledLocalReceipts = await acknowledgePendingLocalPeerReceives(engine);
  if (settledLocalReceipts) console.log('[SOVEREIGN LOCAL RECEIPTS]', JSON.stringify({ acknowledged: settledLocalReceipts, disposition: 'local-only' }));
  if (stopping) return;

  peerNode = await createSovereignPeer({ onEnvelope: acceptPeerEnvelope });
  if (stopping) {
    await peerNode.stop().catch(() => {});
    return;
  }

  // Configure the peer-owned backend before the node accepts inbound envelopes.
  if (String(process.env.APEX_PEER_STORAGE_ENABLED || '').toLowerCase() === 'true') {
    const configuredBackendModule = String(process.env.APEX_PEER_STORAGE_BACKEND_MODULE || '').trim();
    const backendModule = configuredBackendModule
      ? path.resolve(configuredBackendModule)
      : new URL('./peer-owned-binary-backend.mjs', import.meta.url).pathname;
    const moduleUrl = pathToFileURL(backendModule).href;
    const backendFactory = await import(moduleUrl);
    if (typeof backendFactory.createPeerOwnedBinaryBackend !== 'function') {
      throw new Error('peer backend module must export createPeerOwnedBinaryBackend({ peerId, namespaceAcl })');
    }
    peerStorageStore = await backendFactory.createPeerOwnedBinaryBackend({
      peerId: peerNode.peerId.toString(),
      namespaceAcl: process.env.APEX_PEER_NAMESPACE_ACL || ''
    });
    peerStorageRuntime = await initializePeerObjectStorage({
      enabled: true, store: peerStorageStore, peerId: () => peerNode?.peerId?.toString?.() || ''
    });
  }

  await peerNode.start();
  if (stopping) {
    await peerNode.stop().catch(() => {});
    return;
  }
  // node.start() has resolved; verify that libp2p actually bound a listen address.
  // The current libp2p node API does not expose an isStarted() method.
  const peerAddresses = peerNode.getMultiaddrs?.() || [];
  runtimeReadiness.peerReady = peerAddresses.length > 0;
  if (!runtimeReadiness.peerReady) {
    throw new Error('libp2p start resolved without any listen address');
  }
  process.env.APEX_SOVEREIGN_PEER_ID = peerNode.peerId.toString();

  if (peerStorageRuntime.enabled) {
    const storageNamespace = String(process.env.APEX_PEER_CAS_NAMESPACE || 'KernelVision');
    const proof = await peerStorageStore.health?.({ namespace: storageNamespace, peerId: peerNode.peerId.toString() });
    runtimeReadiness.peerStorageVerified = proof?.durable === true &&
      proof?.ownership === 'peer-owned' && proof?.restartRecoveryVerified === true &&
      proof?.atomicReferencesVerified === true && proof?.peerId === peerNode.peerId.toString() &&
      proof?.namespace === storageNamespace && Boolean(proof?.receipt) &&
      typeof peerStorageStore.verifyDurabilityReceipt === 'function' &&
      await peerStorageStore.verifyDurabilityReceipt(proof.receipt, {
        namespace: storageNamespace, peerId: peerNode.peerId.toString(),
        restartRecoveryVerified: true, atomicReferencesVerified: true
      }) === true;
    if (!runtimeReadiness.peerStorageVerified) {
      throw new Error('peer-owned backend did not prove durable writes, atomic references, and restart recovery');
    }
  }
  console.log('[SOVEREIGN PEER OBJECT STORAGE]', JSON.stringify({ enabled: peerStorageRuntime.enabled, verified: runtimeReadiness.peerStorageVerified }));

  if (String(process.env.APEX_PEER_CAS_ENABLED || '').toLowerCase() === 'true') {
    const liveModelRuntime = await startPeerCasRuntime({ peerNode });
    modelBridge = liveModelRuntime.bridge;
    console.log('[APEX PEER-CAS MODEL BRIDGE]', JSON.stringify({
      status: 'listening', namespace: liveModelRuntime.namespace, peerCount: liveModelRuntime.peers.length
    }));
  }
  if (stopping) return;
  try {
    await verifyRemotePersistenceReadiness();
  } catch (error) {
    runtimeReadiness.remotePersistenceVerified = false;
    console.error('[SOVEREIGN READINESS] remote CAS probe failed; readiness remains closed', String(error?.message || error));
  }
  await publishRuntimeIdentity('starting');
  if (stopping) return;

  edgeNode = await createApexEdgeNode({
    peerNode,
    onState: (state) => console.log('[EDGE STATE]', JSON.stringify({
      selected: state.network?.selected,
      mptcp: state.mptcp,
      error: state.error
    }))
  });
  if (stopping) {
    await edgeNode?.stop().catch(() => {});
    await peerNode?.stop().catch(() => {});
    return;
  }

  bridge = createSovereignDurableBridge({
    engine,
    store: apexPureStore,
    workerId,
    peerNode,
    peerAddress,
    sendPeer: sendToPeer
  });
  if (stopping) return;

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

  if (stopping) return;
  cyclePromise = runCycle(bridge);
  await cyclePromise;
  if (stopping) return;
  runtimeReadiness.dispatchReady = true;
  await publishRuntimeIdentity('online');
  const readinessReady = runtimeReadiness.storageReady && runtimeReadiness.peerReady && runtimeReadiness.remotePersistenceVerified && runtimeReadiness.peerStorageVerified && runtimeReadiness.dispatchReady;
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

  if (stopping) return;
  timer = setInterval(() => {
    if (stopping) return;
    cyclePromise = cyclePromise
      .then(() => stopping ? undefined : runCycle(bridge))
      .catch((error) => {
        cycleFailed = true;
        process.exitCode = 1;
        console.error('[SOVEREIGN] cycle failed', String(error?.message || error));
      });
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
    ready: runtimeReadiness.storageReady && runtimeReadiness.peerReady && runtimeReadiness.remotePersistenceVerified && runtimeReadiness.peerStorageVerified && runtimeReadiness.dispatchReady
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
  if (!runtimeReadiness.remotePersistenceVerified) {
    try {
      await verifyRemotePersistenceReadiness();
    } catch (error) {
      console.error('[SOVEREIGN READINESS] remote CAS retry failed; readiness remains closed', String(error?.message || error));
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
  const shutdownEvidence = {
    signal,
    finalCycleSettled: false,
    activeCycleSucceeded: false,
    finalReconcileComplete: false,
    offlineIdentityCommitted: false,
    edgeStopped: false,
    peerStopped: false,
    remotePersistenceVerified: runtimeReadiness.remotePersistenceVerified,
    remotePersistenceHash: runtimeReadiness.remotePersistenceHash
  };
  console.log('[SOVEREIGN] draining', JSON.stringify(shutdownEvidence));
  try {
    await cyclePromise;
    shutdownEvidence.finalCycleSettled = true;
    shutdownEvidence.activeCycleSucceeded = !cycleFailed;
  } catch (error) {
    process.exitCode = 1;
    console.error('[SOVEREIGN] active cycle drain failed', String(error?.message || error));
  }
  try {
    if (bridge) await reconcile(bridge);
    shutdownEvidence.finalReconcileComplete = true;
    console.log('[SOVEREIGN] final reconcile complete');
  } catch (error) {
    process.exitCode = 1;
    console.error('[SOVEREIGN] final reconcile failed', String(error?.message || error));
  }
  try {
    await publishRuntimeIdentity('offline');
    shutdownEvidence.offlineIdentityCommitted = true;
    console.log('[SOVEREIGN] offline identity committed');
  } catch (error) {
    process.exitCode = 1;
    console.error('[SOVEREIGN] offline identity commit failed', String(error?.message || error));
  }
  try {
    if (modelBridge) await modelBridge.close();
  } catch (error) {
    process.exitCode = 1;
    console.error('[SOVEREIGN] Peer-CAS model bridge shutdown failed', String(error?.message || error));
  }
  try {
    if (edgeNode) await edgeNode.stop();
    shutdownEvidence.edgeStopped = true;
    console.log('[SOVEREIGN] edge stopped');
  } catch (error) {
    process.exitCode = 1;
    console.error('[SOVEREIGN] edge shutdown failed', String(error?.message || error));
  }
  try {
    if (peerNode) await peerNode.stop();
    shutdownEvidence.peerStopped = true;
    console.log('[SOVEREIGN] peer stopped');
  } catch (error) {
    process.exitCode = 1;
    console.error('[SOVEREIGN] peer shutdown failed', String(error?.message || error));
  }
  console.log('[SOVEREIGN] shutdown evidence', JSON.stringify(shutdownEvidence));
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

main().catch(async (error) => {
  console.error('[FATAL] Sovereign runtime failed:', error);
  await edgeNode?.stop().catch(() => {});
  await peerNode?.stop().catch(() => {});
  process.exitCode = 1;
});
