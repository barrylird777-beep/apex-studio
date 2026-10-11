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
const MAX_ENVELOPE_BYTES = Math.max(1024, Number(process.env.APEX_PEER_MAX_ENVELOPE_BYTES || 65536));
const bootstrapPeers = () => (process.env.APEX_BOOTSTRAP_PEERS || '').split(',').map(x => x.trim()).filter(Boolean);
const allowedPeerIds = () => new Set((process.env.APEX_ALLOWED_PEER_IDS || '').split(',').map(x => x.trim()).filter(Boolean));
const isAllowedPeer = peerId => allowedPeerIds().has(String(peerId || ''));

async function readJson(stream) {
  let text = '';
  let bytesRead = 0;
  for await (const chunk of stream.source) {
    const bytes = typeof chunk?.subarray === 'function' ? chunk.subarray() : chunk;
    bytesRead += Number(bytes?.byteLength ?? bytes?.length ?? 0);
    if (bytesRead > MAX_ENVELOPE_BYTES) throw new Error('sovereign peer envelope exceeds size limit');
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
      mdns({ interval: 5000 }),
      ...(bootstrapPeers().length ? [bootstrap({ list: bootstrapPeers() })] : [])
    ],
    services: {
      identify: identify(),
      dht: kadDHT({ clientMode: false, kBucketSize: 20 })
    }
  });

  node.addEventListener('peer:discovery', (event) => {
    const discoveredId = event.detail?.id?.toString?.() || '';
    const addresses = event.detail?.multiaddrs || [];
    // Discovery is not authorization. Never auto-dial peers outside the explicit allowlist.
    if (discoveredId && isAllowedPeer(discoveredId) && addresses.length) {
      node.dial(addresses).catch(() => {});
    }
  });

  node.handle(PROTOCOL, async ({ stream, connection }) => {
    try {
      const remotePeerId = connection?.remotePeer?.toString?.() || '';
      if (!isAllowedPeer(remotePeerId)) {
        await stream.sink([encoder.encode(JSON.stringify({ accepted: false, error: 'peer is not allowlisted' }) + '\n')]);
        return;
      }
      const envelope = await readJson(stream);
      const accepted = onEnvelope ? await onEnvelope(envelope) : false;
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
  const address = String(multiaddr || '');
  const match = address.match(/\/p2p\/([^/]+)$/);
  const destinationPeerId = match?.[1] || '';
  if (!destinationPeerId || !isAllowedPeer(destinationPeerId)) {
    throw new Error('outgoing sovereign peer is not allowlisted');
  }
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
