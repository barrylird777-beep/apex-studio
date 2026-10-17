import { createLibp2p } from 'libp2p';
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys';
import { mkdir, open, readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { tcp } from '@libp2p/tcp';
import { noise } from '@libp2p/noise';
import { ping } from '@libp2p/ping';
import { yamux } from '@libp2p/yamux';
import { bootstrap } from '@libp2p/bootstrap';
import { kadDHT } from '@libp2p/kad-dht';
import { identify } from '@libp2p/identify';
import { createPeerSecurityGuard, sealPeerEnvelope, verifyPeerEnvelope } from './sovereign-peer-security.mjs';
import { createPeerIngressGuard } from './peer-ingress-guard.mjs';
import { multiaddr as parseMultiaddr } from '@multiformats/multiaddr';

const PROTOCOL = '/apex/sovereign/1.2.0';
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
const configuredMaxEnvelopeBytes = Number(process.env.APEX_PEER_MAX_ENVELOPE_BYTES || 65536);
const MAX_ENVELOPE_BYTES = Number.isFinite(configuredMaxEnvelopeBytes)
  ? Math.min(1024 * 1024, Math.max(1024, Math.floor(configuredMaxEnvelopeBytes)))
  : 65536;
export function getSovereignBootstrapPeers(value = process.env.APEX_BOOTSTRAP_PEERS || '') {
  const entries = String(value).split(',').map(x => x.trim()).filter(Boolean);
  for (const address of entries) {
    if (!address.startsWith('/ip4/') && !address.startsWith('/ip6/')) {
      throw new Error('Sovereign bootstrap peers must use literal /ip4 or /ip6 multiaddrs; DNS bootstrap is disabled');
    }
    if (/\/(?:dns|dns4|dns6|dnsaddr)\//i.test(address)) {
      throw new Error('DNS-based bootstrap addresses are disabled');
    }
    try { parseMultiaddr(address); }
    catch { throw new Error('Invalid literal-IP sovereign bootstrap multiaddr'); }
    if (!/\/tcp\/\d+(?:\/p2p\/[^/]+)?$/.test(address)) {
      throw new Error('Bootstrap multiaddr must end in a TCP port and optional peer ID');
    }
  }
  return entries;
}
const allowedPeerIds = () => new Set((process.env.APEX_ALLOWED_PEER_IDS || '').split(',').map(x => x.trim()).filter(Boolean));
const isAllowedPeer = peerId => allowedPeerIds().has(String(peerId || ''));
const boundedPositiveInteger = (value, fallback, min, max) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.max(min, Math.min(max, Math.floor(parsed)))
    : fallback;
};

const streamReaders = new WeakMap();
function loadPeerTrustEpochs() {
  const raw = String(process.env.APEX_PEER_TRUST_EPOCHS_JSON || '').trim();
  if (!raw) return new Map();
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('APEX_PEER_TRUST_EPOCHS_JSON must be an object keyed by peer ID');
  }
  const epochs = new Map();
  for (const [peerId, record] of Object.entries(parsed)) {
    if (!peerId || peerId.length > 256 || !record || typeof record !== 'object' || Array.isArray(record)) {
      throw new TypeError('invalid peer trust epoch record');
    }
    const epoch = Number(record.epoch);
    if (!Number.isSafeInteger(epoch) || epoch < 0) throw new TypeError('peer trust epoch must be a nonnegative safe integer');
    epochs.set(peerId, { epoch, revoked: record.revoked === true || record.status === 'revoked' });
  }
  return epochs;
}
const peerSecurity = createPeerSecurityGuard({
  trustEpochs: loadPeerTrustEpochs(),
  requireTrustEpochs: String(process.env.NODE_ENV || '').toLowerCase() === 'production'
});
const outboundPeerSecurity = createPeerSecurityGuard();

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
  const ingressGuard = createPeerIngressGuard({
    windowMs: 60_000,
    maxRequestsPerPeer: boundedPositiveInteger(process.env.APEX_PEER_MAX_REQUESTS_PER_MINUTE, 60, 1, 600),
    maxConcurrentPerPeer: boundedPositiveInteger(process.env.APEX_PEER_MAX_CONCURRENT_PER_PEER, 8, 1, 32),
    maxConcurrentTotal: boundedPositiveInteger(process.env.APEX_PEER_MAX_CONCURRENT_TOTAL, 128, 1, 1024),
    maxTrackedPeers: 4096
  });
  const node = await createLibp2p({
    privateKey,
    // Match Railway's TCP proxy target. Set APEX_P2P_PORT=0 explicitly for local ephemeral-port tests.
    addresses: { listen: [`/ip4/0.0.0.0/tcp/${Number(process.env.APEX_P2P_PORT || 9000)}`] },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: [
      ...(getSovereignBootstrapPeers().length ? [bootstrap({ list: getSovereignBootstrapPeers() })] : [])
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
    let ingressPermit;
    try {
      const remotePeerId = connection?.remotePeer?.toString?.() || '';
      console.info('[SOVEREIGN PEER] inbound stream opened', JSON.stringify({ remotePeerId, streamId: stream.id ?? stream.streamId ?? null, streamStatus: stream.status ?? null }));
      if (!isAllowedPeer(remotePeerId)) {
        await sendSovereignEnvelope(stream, { accepted: false, error: 'peer is not allowlisted' });
        return;
      }
      ingressPermit = ingressGuard.acquire(remotePeerId);
      if (!ingressPermit.ok) {
        console.warn('[SOVEREIGN PEER] inbound request throttled', JSON.stringify({ remotePeerId, reason: ingressPermit.reason }));
        await sendSovereignEnvelope(stream, { accepted: false, error: 'peer request limit reached' });
        return;
      }
      const envelope = await readSovereignEnvelope(stream);
      const envelopeVerification = verifyPeerEnvelope(envelope, remotePeerId);
      if (!envelopeVerification.allowed) {
        await sendSovereignEnvelope(stream, { accepted: false, error: envelopeVerification.reason });
        return;
      }
      const admission = peerSecurity.admit(remotePeerId, envelope);
      if (!admission.allowed) {
        const cached = admission.reason === 'replayed message rejected'
          ? peerSecurity.getReplayResponse(remotePeerId, envelope)
          : null;
        await sendSovereignEnvelope(stream, cached || { accepted: false, error: admission.reason });
        return;
      }
      const outcome = onEnvelope ? await onEnvelope(envelope, { remotePeerId }) : false;
      const response = outcome && typeof outcome === 'object' && !Array.isArray(outcome)
        ? { ...outcome, peerId: node.peerId.toString() }
        : { accepted: Boolean(outcome), peerId: node.peerId.toString() };
      // Cache the exact response before writing it so a lost ACK can be replayed
      // without running the side effect a second time.
      peerSecurity.rememberResponse(remotePeerId, envelope, response);
      await sendSovereignEnvelope(stream, response);
    } catch (error) {
      const errorClass = typeof error?.name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name) ? error.name : 'Error';
      console.error('[SOVEREIGN PEER] inbound envelope failed', JSON.stringify({ errorClass }));
      await sendSovereignEnvelope(stream, { accepted: false, error: 'peer request rejected' }).catch(() => {});
    } finally {
      // A libp2p v3 handler returning with its stream still open can cause the
      // muxer to reset the stream instead of completing the request/ACK exchange.
      // Close only after the response writer has drained; callers already have
      // the complete newline-delimited response before this graceful close.
      ingressPermit?.release();
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
  // Every wire-level request receives a fresh replay-detection identifier.
  // Retries reuse this identifier so a request that was already processed cannot
  // be applied a second time after an ACK/transport failure.
  const outboundEnvelope = sealPeerEnvelope(envelope, localPeerId, Date.now());
  const admission = outboundPeerSecurity.admit(destinationPeerId, outboundEnvelope);
  if (!admission.allowed) throw new Error(admission.reason);
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
      await sendSovereignEnvelope(stream, outboundEnvelope);
      console.info('[HEARTBEAT_WRITE_SUCCESS]', JSON.stringify({ destinationPeerId, streamId: stream.id ?? stream.streamId ?? null, streamStatus: stream.status ?? null, attempt: attempt + 1 }));
      console.info('[HEARTBEAT_AWAIT_RESPONSE]', JSON.stringify({ destinationPeerId, streamId: stream.id ?? stream.streamId ?? null, streamStatus: stream.status ?? null, attempt: attempt + 1 }));
      const response = await readSovereignEnvelope(stream);
      if (!response.accepted) throw new Error(response.error || 'peer rejected envelope');
      if (response.peerId !== destinationPeerId) throw new Error('sovereign peer response identity mismatch');
      console.log('[SOVEREIGN PEER] outbound acknowledged', JSON.stringify({ destinationPeerId, remotePeerId: response.peerId || null, attempt: attempt + 1 }));
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const transportFailure = /stream (?:has been reset|is closed|closed)|Cannot write to a stream that is closed|timed out|connection reset|ECONNRESET|EPIPE/i.test(message);
      const errorClass = typeof error?.name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name) ? error.name : 'Error';
      console.warn('[SOVEREIGN PEER] outbound stream failed', JSON.stringify({ streamStatus: stream?.status ?? null, attempt: attempt + 1, errorClass, transportFailure }));
      if (!transportFailure || attempt === 1) throw error;
      console.warn('[SOVEREIGN PEER] retrying transport failure', JSON.stringify({ attempt: attempt + 1, errorClass }));
    } finally {
      console.info('[HEARTBEAT_CLOSE_START]', JSON.stringify({ destinationPeerId, streamId: stream?.id ?? stream?.streamId ?? null, streamStatus: stream?.status ?? null, attempt: attempt + 1 }));
      try { await stream?.close?.(); } catch (closeError) {
        console.warn('[HEARTBEAT_CLOSE_FAILED]', JSON.stringify({ attempt: attempt + 1, errorClass: closeError instanceof Error ? closeError.name : 'Error' }));
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
