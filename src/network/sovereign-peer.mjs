import { createLibp2p } from 'libp2p';
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys';
import { mkdir, open, readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { tcp } from '@libp2p/tcp';
import { noise } from '@libp2p/noise';
import { ping } from '@libp2p/ping';
import { yamux } from '@libp2p/yamux';
import { mdns } from '@libp2p/mdns';
import { bootstrap } from '@libp2p/bootstrap';
import { kadDHT } from '@libp2p/kad-dht';
import { identify } from '@libp2p/identify';
import { multiaddr as parseMultiaddr } from '@multiformats/multiaddr';

const PROTOCOL = '/apex/sovereign/1.0.0';
const PEER_KEY_FILE = path.resolve(process.env.APEX_PEER_KEY_FILE || path.join(process.env.APEX_SE_X_ROOT || '/srv/apex/se-x', 'identity', 'sovereign-peer.key'));

export async function loadOrCreatePeerPrivateKey(file = PEER_KEY_FILE) {
  const target = path.resolve(file);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  try {
    const info = await lstat(target);
    if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error('sovereign peer identity key permissions are unsafe');
    const bytes = await readFile(target);
    if (!bytes.length) throw new Error('sovereign peer identity key is empty');
    return privateKeyFromProtobuf(bytes);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const key = await generateKeyPair('Ed25519');
  const bytes = Buffer.from(privateKeyToProtobuf(key));
  let handle;
  try {
    handle = await open(target, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    const dir = await open(path.dirname(target), 'r');
    try { await dir.sync(); } finally { await dir.close(); }
    return key;
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error.code !== 'EEXIST') throw error;
    const info = await lstat(target);
    if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error('sovereign peer identity key permissions are unsafe');
    const existing = await readFile(target);
    if (!existing.length) throw new Error('sovereign peer identity key was created empty');
    return privateKeyFromProtobuf(existing);
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_ENVELOPE_BYTES = Math.max(1024, Number(process.env.APEX_PEER_MAX_ENVELOPE_BYTES || 65536));
const bootstrapPeers = () => (process.env.APEX_BOOTSTRAP_PEERS || '').split(',').map(x => x.trim()).filter(Boolean);
const allowedPeerIds = () => new Set((process.env.APEX_ALLOWED_PEER_IDS || '').split(',').map(x => x.trim()).filter(Boolean));
const isAllowedPeer = peerId => allowedPeerIds().has(String(peerId || ''));

export async function readSovereignEnvelope(stream) {
  // libp2p v3 streams are EventTargets; keep the iterable adapter for old callers/tests.
  if (stream?.source && typeof stream.source[Symbol.asyncIterator] === 'function') {
    let text = '';
    let bytesRead = 0;
    const localDecoder = new TextDecoder();
    for await (const chunk of stream.source) {
      const bytes = typeof chunk?.subarray === 'function' ? chunk.subarray() : chunk;
      bytesRead += Number(bytes?.byteLength ?? bytes?.length ?? 0);
      if (bytesRead > MAX_ENVELOPE_BYTES) throw new Error('sovereign peer envelope exceeds size limit');
      text += localDecoder.decode(bytes, { stream: true });
      if (text.includes('\\n')) break;
    }
    const line = text.split('\\n')[0];
    if (!line) throw new Error('empty sovereign peer envelope');
    return JSON.parse(line);
  }

  if (!stream || typeof stream.addEventListener !== 'function') {
    throw new TypeError('unsupported sovereign peer stream interface');
  }

  return new Promise((resolve, reject) => {
    let text = '';
    let bytesRead = 0;
    let settled = false;
    const localDecoder = new TextDecoder();
    const cleanup = () => {
      clearTimeout(timer);
      stream.removeEventListener?.('message', onMessage);
      stream.removeEventListener?.('close', onClose);
    };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    };
    const onMessage = event => {
      try {
        const chunk = event.data;
        const bytes = typeof chunk?.subarray === 'function' ? chunk.subarray() : chunk;
        bytesRead += Number(bytes?.byteLength ?? bytes?.length ?? 0);
        if (bytesRead > MAX_ENVELOPE_BYTES) throw new Error('sovereign peer envelope exceeds size limit');
        text += localDecoder.decode(bytes, { stream: true });
        const newline = text.indexOf('\\n');
        if (newline < 0) return;
        const line = text.slice(0, newline);
        if (!line) throw new Error('empty sovereign peer envelope');
        finish(null, JSON.parse(line));
      } catch (error) {
        finish(error);
      }
    };
    const onClose = event => finish(new Error(event?.error?.message || 'sovereign peer stream closed before an envelope arrived'));
    const timer = setTimeout(() => finish(new Error('sovereign peer envelope timed out')), Number(process.env.APEX_PEER_DIAL_TIMEOUT_MS || 10000));
    stream.addEventListener('message', onMessage);
    stream.addEventListener('close', onClose);
  });
}

async function sendSovereignEnvelope(stream, envelope) {
  const bytes = encoder.encode(JSON.stringify(envelope) + '\\n');
  if (typeof stream?.send !== 'function') {
    // Compatibility for pre-v3 iterable streams.
    if (typeof stream?.sink === 'function') return stream.sink([bytes]);
    throw new TypeError('unsupported sovereign peer stream write interface');
  }
  if (stream.send(bytes)) return;
  if (typeof stream.onDrain === 'function') {
    await stream.onDrain({ signal: AbortSignal.timeout(Number(process.env.APEX_PEER_DIAL_TIMEOUT_MS || 10000)) });
    return;
  }
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => cleanup(new Error('sovereign peer stream write timed out')), Number(process.env.APEX_PEER_DIAL_TIMEOUT_MS || 10000));
    const cleanup = error => {
      clearTimeout(timer);
      stream.removeEventListener?.('drain', onDrain);
      stream.removeEventListener?.('close', onClose);
      if (error) reject(error);
      else resolve();
    };
    const onDrain = () => cleanup();
    const onClose = () => cleanup(new Error('sovereign peer stream closed while backpressured'));
    stream.addEventListener('drain', onDrain, { once: true });
    stream.addEventListener('close', onClose, { once: true });
  });
}
export async function createSovereignPeer({ onEnvelope, keyFile = PEER_KEY_FILE } = {}) {
  const privateKey = await loadOrCreatePeerPrivateKey(keyFile);
  const node = await createLibp2p({
    privateKey,
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
      ping: ping(),
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
      const envelope = await readSovereignEnvelope(stream);
      const accepted = onEnvelope ? await onEnvelope(envelope, { remotePeerId }) : false;
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
  const target = typeof multiaddr === 'string' ? parseMultiaddr(multiaddr) : multiaddr;
  const stream = await node.dialProtocol(target, PROTOCOL, {
    signal: AbortSignal.timeout(Number(process.env.APEX_PEER_DIAL_TIMEOUT_MS || 10000))
  });
  await stream.sink([encoder.encode(JSON.stringify(envelope) + '\n')]);
  const response = await readSovereignEnvelope(stream);
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
