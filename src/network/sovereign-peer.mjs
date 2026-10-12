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
const MAX_ENVELOPE_BYTES = Math.max(1024, Number(process.env.APEX_PEER_MAX_ENVELOPE_BYTES || 65536));
const bootstrapPeers = () => (process.env.APEX_BOOTSTRAP_PEERS || '').split(',').map(x => x.trim()).filter(Boolean);
const allowedPeerIds = () => new Set((process.env.APEX_ALLOWED_PEER_IDS || '').split(',').map(x => x.trim()).filter(Boolean));
const isAllowedPeer = peerId => allowedPeerIds().has(String(peerId || ''));

const streamReaders = new WeakMap();

function readerFor(stream) {
  let reader = streamReaders.get(stream);
  if (reader) return reader;

  // Prefer the stream's own async iterator when available. Some libp2p
  // transports emit message events for diagnostics but don't reliably feed
  // the same chunks to that event adapter under concurrent bidirectional use.
  const iterable = stream?.source && typeof stream.source[Symbol.asyncIterator] === 'function'
    ? stream.source
    : stream && typeof stream[Symbol.asyncIterator] === 'function'
      ? stream
      : null;

  if (iterable) {
    reader = {
      iterator: iterable[Symbol.asyncIterator](),
      decoder: new TextDecoder(),
      text: '',
      bytesRead: 0,
      pending: null,
      cleanup: () => {}
    };
  } else if (stream && typeof stream.addEventListener === 'function') {
    const queue = [];
    const waiters = [];
    let ended = false;
    let closeError = null;
    const onMessage = event => {
      const waiter = waiters.shift();
      if (waiter) waiter.resolve({ done: false, value: event?.data });
      else queue.push(event?.data);
    };
    const onClose = event => {
      ended = true;
      closeError = event?.error || null;
      while (waiters.length) {
        const waiter = waiters.shift();
        if (closeError) waiter.reject(closeError);
        else waiter.resolve({ done: true });
      }
    };
    stream.addEventListener('message', onMessage);
    stream.addEventListener('close', onClose);
    reader = {
      iterator: {
        next: () => {
          if (queue.length) return Promise.resolve({ done: false, value: queue.shift() });
          if (ended) return closeError ? Promise.reject(closeError) : Promise.resolve({ done: true });
          return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
        }
      },
      decoder: new TextDecoder(),
      text: '',
      bytesRead: 0,
      pending: null,
      cleanup: () => {
        stream.removeEventListener?.('message', onMessage);
        stream.removeEventListener?.('close', onClose);
      }
    };
    stream.resume?.();
  } else {
    throw new TypeError('unsupported sovereign peer stream read interface');
  }

  streamReaders.set(stream, reader);
  // The inbound handler pauses a new stream before attaching its reader.
  // Resume only after the iterator/listeners are ready, or both sides can
  // wait forever for a first envelope that the transport is holding back.
  stream.resume?.();
  return reader;
}

export async function readSovereignEnvelope(stream) {
  // Keep one reader and its unread buffer per stream. Prefer libp2p v3
  // message events; the async-iterator fallback preserves older adapters.
  const reader = readerFor(stream);
  const timeoutMs = Math.max(1, Number(process.env.APEX_PEER_DIAL_TIMEOUT_MS || 10000));
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const newline = reader.text.indexOf('\n');
    if (newline >= 0) {
      const line = reader.text.slice(0, newline);
      reader.text = reader.text.slice(newline + 1);
      if (!line) throw new Error('empty sovereign peer envelope');
      return JSON.parse(line);
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('sovereign peer envelope timed out');
    reader.pending ||= reader.iterator.next();
    let timer;
    let result;
    try {
      result = await Promise.race([
        reader.pending,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('sovereign peer envelope timed out')), remaining);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (result) reader.pending = null;
    if (!result || result.done) {
      reader.text += reader.decoder.decode();
      const finalNewline = reader.text.indexOf('\n');
      if (finalNewline >= 0) {
        const line = reader.text.slice(0, finalNewline);
        reader.text = reader.text.slice(finalNewline + 1);
        if (!line) throw new Error('empty sovereign peer envelope');
        return JSON.parse(line);
      }
      throw new Error('sovereign peer stream closed before an envelope arrived');
    }

    const chunk = result.value;
    const bytes = typeof chunk?.subarray === 'function' ? chunk.subarray() : chunk;
    reader.bytesRead += Number(bytes?.byteLength ?? bytes?.length ?? 0);
    if (reader.bytesRead > MAX_ENVELOPE_BYTES) throw new Error('sovereign peer envelope exceeds size limit');
    reader.text += reader.decoder.decode(bytes, { stream: true });
  }
}

async function sendSovereignEnvelope(stream, envelope) {
  const bytes = encoder.encode(JSON.stringify(envelope) + '\n');
  if (typeof stream?.send !== 'function') {
    if (typeof stream?.sink === 'function') return stream.sink([bytes]);
    throw new TypeError('unsupported sovereign peer stream write interface');
  }
  if (stream.send(bytes) !== false) return;
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

  node.addEventListener('peer:discovery', event => {
    const discoveredId = event.detail?.id?.toString?.() || '';
    const addresses = event.detail?.multiaddrs || [];
    if (discoveredId && isAllowedPeer(discoveredId) && addresses.length) {
      node.dial(addresses).catch(() => {});
    }
  });

  // libp2p v3 passes a handler context object, not positional stream/connection arguments.
  // libp2p v3 passes the stream and connection as separate arguments.
  node.handle(PROTOCOL, async (stream, connection) => {
    // Pause immediately so an early peer message cannot arrive before the
    // envelope reader attaches its message listener.
    stream.pause?.();
    try {
      const remotePeerId = connection?.remotePeer?.toString?.() || '';
      if (!isAllowedPeer(remotePeerId)) {
        await sendSovereignEnvelope(stream, { accepted: false, error: 'peer is not allowlisted' });
        return;
      }
      const envelope = await readSovereignEnvelope(stream);
      const accepted = onEnvelope ? await onEnvelope(envelope, { remotePeerId }) : false;
      await sendSovereignEnvelope(stream, { accepted: Boolean(accepted), peerId: node.peerId.toString() });
    } catch (error) {
      console.error('[SOVEREIGN PEER] inbound envelope failed', JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        remotePeerId: connection?.remotePeer?.toString?.() || ''
      }));
      await sendSovereignEnvelope(stream, { accepted: false, error: error instanceof Error ? error.message : String(error) }).catch(() => {});
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
  const responsePromise = readSovereignEnvelope(stream);
  await sendSovereignEnvelope(stream, envelope);
  const response = await responsePromise;
  await stream.close?.();
  if (!response.accepted) throw new Error(response.error || 'peer rejected envelope');
  return response;
}

export { PROTOCOL };

if (import.meta.url === `file://${process.argv[1]}`) {
  const node = await startSovereignPeer({
    onEnvelope: async envelope => envelope?.type === 'durable.accept'
  });
  console.log('[SOVEREIGN PEER] ONLINE', JSON.stringify({
    peerId: node.peerId.toString(),
    listenAddresses: node.getMultiaddrs().map(String),
    protocol: PROTOCOL
  }));
  const stop = async signal => {
    console.log(`[SOVEREIGN PEER] stopping on ${signal}`);
    await node.stop();
  };
  process.once('SIGTERM', () => void stop('SIGTERM'));
  process.once('SIGINT', () => void stop('SIGINT'));
}
