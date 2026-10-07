import os from 'node:os';
import { createSovereignPeer, sendToPeer } from '../network/sovereign-peer.mjs';
import { appendEvent, enqueueJob, paths, replay } from './sovereign-local-storage.mjs';

const workerId = process.env.APEX_SOVEREIGN_WORKER_ID || `sovereign-${os.hostname()}-${process.pid}`;
const peerAddress = process.env.APEX_SOVEREIGN_PEER_ADDRESS || '';
let peerNode;
let stopping = false;

async function acceptPeerEnvelope(envelope) {
  if (!envelope || !['durable.accept', 'edge.heartbeat'].includes(envelope.type)) throw new Error('unsupported sovereign envelope');
  if (envelope.type === 'edge.heartbeat') return true;
  if (!envelope.waveId || !envelope.jobId || !envelope.checksum) throw new Error('incomplete sovereign envelope');
  await appendEvent('peer.receipt', { ...envelope, acceptedBy: workerId }, { id: envelope.jobId, stream: 'peers' });
  return true;
}

async function main() {
  peerNode = await createSovereignPeer({ onEnvelope: acceptPeerEnvelope });
  await peerNode.start();
  process.env.APEX_SOVEREIGN_PEER_ID = peerNode.peerId.toString();

  await replay();
  await appendEvent('runtime.online', {
    workerId,
    peerId: peerNode.peerId.toString(),
    peerAddress: peerAddress || null,
    storage: paths,
    concurrency: Number(process.env.APEX_WORKER_CONCURRENCY || os.availableParallelism?.() || os.cpus().length || 1)
  });

  if (process.env.APEX_BOOTSTRAP_JOB === 'true') {
    await enqueueJob({ type: 'sovereign.heartbeat', payload: { workerId } });
  }

  console.log('[LOCAL SOVEREIGN RUNTIME] ONLINE', JSON.stringify({
    workerId,
    peerId: peerNode.peerId.toString(),
    storage: paths
  }));
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  await appendEvent('runtime.shutdown', { workerId, signal }).catch(() => {});
  await peerNode?.stop().catch(() => {});
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
main().catch(error => { console.error('[LOCAL SOVEREIGN RUNTIME] FATAL', error); process.exitCode = 1; });
