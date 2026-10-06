import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { selectNetworkPath } from './path-selector.mjs';
import { createSovereignPeer, sendToPeer } from './sovereign-peer.mjs';

const exec = promisify(execFile);
const DEFAULT_INTERVAL_MS = 5000;

async function readMptcpState() {
  try {
    const { stdout } = await exec('cat', ['/proc/sys/net/mptcp/enabled']);
    const enabled = stdout.trim() === '1';
    let endpoints = [];
    try {
      const { stdout: endpointOutput } = await exec('ip', ['mptcp', 'endpoint', 'show']);
      endpoints = endpointOutput.trim().split('\n').filter(Boolean);
    } catch {}
    return { available: true, enabled, endpoints };
  } catch (error) {
    return { available: false, enabled: false, endpoints: [], error: error.message };
  }
}

export async function inspectEdgeNode() {
  const [network, mptcp] = await Promise.all([selectNetworkPath(), readMptcpState()]);
  return {
    timestamp: new Date().toISOString(),
    identity: { hostname: os.hostname(), platform: process.platform, arch: process.arch, node: process.version },
    network,
    mptcp,
    capabilities: { pathSelector: true, mptcpObservation: mptcp.available, sovereignNoisePeer: true, ipfsSwarm: true }
  };
}

export async function createApexEdgeNode({
  peerAddress = process.env.APEX_EDGE_PEER_ADDRESS || process.env.APEX_SOVEREIGN_PEER_ADDRESS || '',
  peerNode: existingPeerNode = null,
  onState = () => {}
} = {}) {
  const intervalMs = Math.max(1000, Number(process.env.APEX_EDGE_INTERVAL_MS || DEFAULT_INTERVAL_MS));
  const state = { online: false, last: null, peerId: null };
  const ownsPeerNode = !existingPeerNode;
  const peerNode = existingPeerNode || await createSovereignPeer({ onEnvelope: async (envelope) => envelope?.type === 'edge.heartbeat' });
  if (ownsPeerNode) await peerNode.start();
  state.peerId = peerNode.peerId.toString();
  state.online = true;
  let stopped = false;
  let timer;

  const tick = async () => {
    if (stopped) return;
    try {
      const snapshot = await inspectEdgeNode();
      snapshot.identity.peerId = state.peerId;
      state.last = snapshot;
      onState(snapshot);
      if (peerAddress) {
        await sendToPeer(peerNode, peerAddress, {
          type: 'edge.heartbeat',
          peerId: state.peerId,
          timestamp: snapshot.timestamp,
          selectedPath: snapshot.network.selected?.device || null,
          network: snapshot.network.selected?.network || null,
          mptcp: snapshot.mptcp
        });
      }
    } catch (error) {
      state.last = { timestamp: new Date().toISOString(), error: error.message };
      onState(state.last);
    }
  };

  await tick();
  timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();

  return {
    peerNode,
    state,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      if (timer) clearInterval(timer);
      if (ownsPeerNode) await peerNode.stop().catch(() => {});
      state.online = false;
    }
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const node = await createApexEdgeNode({ onState: (state) => console.log('[APEX EDGE]', JSON.stringify(state)) });
  const stop = async (signal) => { console.log(`[APEX EDGE] stopping on ${signal}`); await node.stop(); };
  process.once('SIGTERM', () => void stop('SIGTERM'));
  process.once('SIGINT', () => void stop('SIGINT'));
}
