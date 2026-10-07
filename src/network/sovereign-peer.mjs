import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@libp2p/noise';
import { yamux } from '@libp2p/yamux';
import { mdns } from '@libp2p/mdns';
import { bootstrap } from '@libp2p/bootstrap';
import { kadDHT } from '@libp2p/kad-dht';
import { identify } from '@libp2p/identify';

const PROTOCOL = '/apex/sovereign/1.0.0';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const bootstrapPeers = () => (process.env.APEX_BOOTSTRAP_PEERS || '').split(',').map(x => x.trim()).filter(Boolean);
const allowedPeerIds = () => new Set((process.env.APEX_ALLOWED_PEER_IDS || '').split(',').map(x => x.trim()).filter(Boolean));
const discoveryEnabled = () => process.env.APEX_ENABLE_MDNS === 'true';
const requireAllowlist = () => process.env.APEX_REQUIRE_PEER_ALLOWLIST !== 'false';

async function readJson(stream) {
  let text = '';
  for await (const chunk of stream.source) {
    const bytes = typeof chunk?.subarray === 'function' ? chunk.subarray() : chunk;
    text += decoder.decode(bytes, { stream: true });
    if (text.includes('\n')) break;
  }
  const line = text.split('\n')[0];
  if (!line) throw new Error('empty sovereign peer envelope');
  return JSON.parse(line);
}

export async function createSovereignPeer({ onEnvelope } = {}) {
  const node = await createLibp2p({
    addresses: { listen: [`/ip4/0.0.0.0/tcp/${Number(process.env.APEX_P2P_PORT || 0)}`] },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: [
      ...(discoveryEnabled() ? [mdns({ interval: 5000 })] : []),
      ...(bootstrapPeers().length ? [bootstrap({ list: bootstrapPeers() })] : [])
    ],
    services: {
      identify: identify(),
      dht: kadDHT({ clientMode: false, kBucketSize: 20 })
    }
  });

  node.addEventListener('peer:discovery', (event) => {
    const addresses = event.detail?.multiaddrs || [];
    if (addresses.length) {
      node.dial(addresses).catch(() => {});
    }
  });

  node.handle(PROTOCOL, async ({ stream, connection }) => {
    try {
      const remotePeerId = connection?.remotePeer?.toString?.() || '';
      const allowlist = allowedPeerIds();
      if (requireAllowlist() && (!allowlist.size || !allowlist.has(remotePeerId))) throw new Error('peer is not allowlisted');
      const envelope = await readJson(stream);
      const accepted = onEnvelope ? await onEnvelope(envelope) : true;
      await stream.sink([encoder.encode(JSON.stringify({ accepted: Boolean(accepted), peerId: node.peerId.toString() }) + '\n')]);
    } catch (error) {
      await stream.sink([encoder.encode(JSON.stringify({ accepted: false, error: error instanceof Error ? error.message : String(error) }) + '\n')]);
    }
  });
  return node;
}

export async function startSovereignPeer(options) {
  const node = await createSovereignPeer(options);
  await node.start();
  return node;
}

export async function sendToPeer(node, multiaddr, envelope) {
  const stream = await node.dialProtocol(multiaddr, PROTOCOL, {
    signal: AbortSignal.timeout(Number(process.env.APEX_PEER_DIAL_TIMEOUT_MS || 10000))
  });
  await stream.sink([encoder.encode(JSON.stringify(envelope) + '\n')]);
  const response = await readJson(stream);
  await stream.close?.();
  if (!response.accepted) throw new Error(response.error || 'peer rejected envelope');
  return response;
}

export { PROTOCOL };


if (import.meta.url === `file://${process.argv[1]}`) {
  const node = await startSovereignPeer({
    onEnvelope: async (envelope) => envelope?.type === 'durable.accept'
  });
  console.log('[SOVEREIGN PEER] ONLINE', JSON.stringify({
    peerId: node.peerId.toString(),
    listenAddresses: node.getMultiaddrs().map(String),
    protocol: PROTOCOL
  }));
  const stop = async (signal) => {
    console.log(`[SOVEREIGN PEER] stopping on ${signal}`);
    await node.stop();
  };
  process.once('SIGTERM', () => void stop('SIGTERM'));
  process.once('SIGINT', () => void stop('SIGINT'));
}
