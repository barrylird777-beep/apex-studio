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
  // Production containers may be ephemeral. A per-peer secret can preserve the
  // libp2p identity without writing its private key to a local filesystem.
  const encoded = String(process.env.APEX_PEER_PRIVATE_KEY_BASE64 || '').trim();
  if (encoded) {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
      throw new Error('APEX_PEER_PRIVATE_KEY_BASE64 must be valid base64-encoded libp2p private-key protobuf');
    }
    const bytes = Buffer.from(encoded, 'base64');
    if (!bytes.length || bytes.toString('base64') !== encoded) {
      throw new Error('APEX_PEER_PRIVATE_KEY_BASE64 is empty or not canonical base64');
    }
    return privateKeyFromProtobuf(bytes);
  }
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

function readerFor(stream, { resume = true } = {}) {
  let reader = streamReaders.get(stream);
  if (reader) return reader;

  // libp2p's stream adapter used in production delivers chunks through
  // EventTarget "message" events. Prefer that interface when present; choosing
  // source's async iterator first can leave the reader waiting forever even
  // while messages are visibly arriving on the stream.
  if (stream && typeof stream.addEventListener === 'function') {
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
  } else {
    const iterable = stream?.source && typeof stream.source[Symbol.asyncIterator] === 'function'
      ? stream.source
      : stream && typeof stream[Symbol.asyncIterator] === 'function'
        ? stream
        : null;
    if (!iterable) throw new TypeError('unsupported sovereign peer stream read interface');
    reader = {
      iterator: iterable[Symbol.asyncIterator](),
      decoder: new TextDecoder(),
      text: '',
      bytesRead: 0,
      pending: null,
      cleanup: () => {}
    };
  }

  streamReaders.set(stream, reader);
  // Event-based streams need to be resumed after listeners attach, but a
  // closing/closed libp2p stream must never be resumed.
  if (resume && stream.status !== 'closing' && stream.status !== 'closed') {
    try { stream.resume?.(); }
    catch (error) {
      // libp2p can close the stream between the status check and resume.
      // Treat that as a closed transport, not an uncaught process-level failure.
      if (!/closing\/closed/i.test(error instanceof Error ? error.message : String(error))) throw error;
    }
  }
  return reader;
}

export async function readSovereignEnvelope(stream, options = {}) {
  // Keep one reader and its unread buffer per stream. Prefer libp2p v3
  // message events; the async-iterator fallback preserves older adapters.
  const reader = readerFor(stream, options);
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
  const drainSignal = () => AbortSignal.timeout(Number(process.env.APEX_PEER_DIAL_TIMEOUT_MS || 10000));
  const accepted = stream.send(bytes);
  // A successful send means the bytes were accepted into libp2p's outbound
  // buffer, not necessarily flushed to the remote peer. Wait for the buffer
  // to drain before a request handler returns (which can otherwise reset the
  // stream before the ACK reaches the caller).
  if (typeof stream.onDrain === 'function') {
    await stream.onDrain({ signal: drainSignal() });
    return;
  }
  if (accepted !== false) return;
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
    // Match Railway's TCP proxy target. Set APEX_P2P_PORT=0 explicitly for local ephemeral-port tests.
    addresses: { listen: [`/ip4/0.0.0.0/tcp/${Number(process.env.APEX_P2P_PORT || 9000)}`] },
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

  // libp2p v3 handlers receive a context object ({ stream, connection });
  // accept the older positional form too, so the transport adapter is explicit.
  node.handle(PROTOCOL, async (streamOrContext, maybeConnection) => {
    const contextForm = streamOrContext && typeof streamOrContext === 'object' && 'stream' in streamOrContext;
    const stream = contextForm ? streamOrContext.stream : streamOrContext;
    const connection = contextForm ? streamOrContext.connection : maybeConnection;
    if (!stream || typeof stream !== 'object') throw new TypeError('libp2p handler did not provide a stream');
    // Attach the message listener immediately. EventTarget does not replay
    // messages emitted before a listener is registered, so pausing first can
    // lose the first envelope during fast cross-region handshakes.
    readerFor(stream);
    try {
      const remotePeerId = connection?.remotePeer?.toString?.() || '';
      console.info('[SOVEREIGN PEER] inbound stream opened', JSON.stringify({ remotePeerId, streamId: stream.id ?? stream.streamId ?? null, streamStatus: stream.status ?? null }));
      if (!isAllowedPeer(remotePeerId)) {
        await sendSovereignEnvelope(stream, { accepted: false, error: 'peer is not allowlisted' });
        return;
      }
      const envelope = await readSovereignEnvelope(stream);
      const outcome = onEnvelope ? await onEnvelope(envelope, { remotePeerId }) : false;
      const response = outcome && typeof outcome === 'object' && !Array.isArray(outcome)
        ? { ...outcome, peerId: node.peerId.toString() }
        : { accepted: Boolean(outcome), peerId: node.peerId.toString() };
      await sendSovereignEnvelope(stream, response);
    } catch (error) {
      console.error('[SOVEREIGN PEER] inbound envelope failed', JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        remotePeerId: connection?.remotePeer?.toString?.() || ''
      }));
      await sendSovereignEnvelope(stream, { accepted: false, error: error instanceof Error ? error.message : String(error) }).catch(() => {});
    } finally {
      // A libp2p v3 handler returning with its stream still open can cause the
      // muxer to reset the stream instead of completing the request/ACK exchange.
      // Close only after the response writer has drained; callers already have
      // the complete newline-delimited response before this graceful close.
      try { await stream.close?.(); } catch {}
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
  const localPeerId = node?.peerId?.toString?.() || '';
  if (localPeerId && destinationPeerId === localPeerId) {
    throw new Error('outgoing sovereign peer cannot dial itself');
  }
  const target = typeof multiaddr === 'string' ? parseMultiaddr(multiaddr) : multiaddr;
  // Retry only transport failures on a fresh stream; never retry peer rejection.
  for (let attempt = 0; attempt < 2; attempt++) {
    let stream;
    try {
      console.info('[HEARTBEAT_DIAL_START]', JSON.stringify({ destinationPeerId, streamId: stream?.id ?? stream?.streamId ?? null, attempt: attempt + 1 }));
      stream = await node.dialProtocol(target, PROTOCOL, {
        signal: AbortSignal.timeout(Number(process.env.APEX_PEER_DIAL_TIMEOUT_MS || 10000))
      });
      console.info('[HEARTBEAT_DIAL_SUCCESS]', JSON.stringify({ destinationPeerId, streamId: stream.id ?? stream.streamId ?? null, streamStatus: stream.status ?? null, attempt: attempt + 1 }));
      console.info('[SOVEREIGN PEER] outbound stream opened', JSON.stringify({ destinationPeerId, streamId: stream.id ?? stream.streamId ?? null, streamStatus: stream.status ?? null, attempt: attempt + 1 }));
      // Attach the reader before writing so event-based streams cannot lose a fast ACK,
      // but do not await the response until the complete envelope has drained.
      // This preserves incoming bytes that arrive during the write without racing read/write.
      readerFor(stream);
      console.info('[HEARTBEAT_WRITE_START]', JSON.stringify({ destinationPeerId, streamId: stream.id ?? stream.streamId ?? null, streamStatus: stream.status ?? null, attempt: attempt + 1 }));
      await sendSovereignEnvelope(stream, envelope);
      console.info('[HEARTBEAT_WRITE_SUCCESS]', JSON.stringify({ destinationPeerId, streamId: stream.id ?? stream.streamId ?? null, streamStatus: stream.status ?? null, attempt: attempt + 1 }));
      console.info('[HEARTBEAT_AWAIT_RESPONSE]', JSON.stringify({ destinationPeerId, streamId: stream.id ?? stream.streamId ?? null, streamStatus: stream.status ?? null, attempt: attempt + 1 }));
      const response = await readSovereignEnvelope(stream);
      if (!response.accepted) throw new Error(response.error || 'peer rejected envelope');
      console.log('[SOVEREIGN PEER] outbound acknowledged', JSON.stringify({ destinationPeerId, remotePeerId: response.peerId || null, attempt: attempt + 1 }));
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[SOVEREIGN PEER] outbound stream failed', JSON.stringify({ destinationPeerId, streamId: stream?.id ?? stream?.streamId ?? null, streamStatus: stream?.status ?? null, attempt: attempt + 1, error: message }));
      const transportFailure = /stream (?:has been reset|is closed|closed)|Cannot write to a stream that is closed|timed out|connection reset|ECONNRESET|EPIPE/i.test(message);
      if (!transportFailure || attempt === 1) throw error;
      console.warn('[SOVEREIGN PEER] retrying transport failure', JSON.stringify({ destinationPeerId, attempt: attempt + 1, error: message }));
    } finally {
      console.info('[HEARTBEAT_CLOSE_START]', JSON.stringify({ destinationPeerId, streamId: stream?.id ?? stream?.streamId ?? null, streamStatus: stream?.status ?? null, attempt: attempt + 1 }));
      try { await stream?.close?.(); } catch (closeError) {
        console.warn('[HEARTBEAT_CLOSE_FAILED]', JSON.stringify({ destinationPeerId, streamId: stream?.id ?? stream?.streamId ?? null, error: closeError instanceof Error ? closeError.message : String(closeError), attempt: attempt + 1 }));
      }
    }
  }
  throw new Error('sovereign peer send failed after transport retry');
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
