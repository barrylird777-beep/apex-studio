import net from 'node:net';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';

const RTMP_VERSION = 3;
const HANDSHAKE_SIZE = 1536;
const DEFAULT_CHUNK_SIZE = 128;
const DEFAULT_OUT_CHUNK_SIZE = 4096;
const TYPE_SET_CHUNK_SIZE = 1;
const TYPE_ABORT = 2;
const TYPE_ACK = 3;
const TYPE_USER_CONTROL = 4;
const TYPE_WINDOW_ACK = 5;
const TYPE_PEER_BANDWIDTH = 6;
const TYPE_AUDIO = 8;
const TYPE_VIDEO = 9;
const TYPE_AMF0_COMMAND = 20;
const TYPE_AMF0_DATA = 18;

function required(value, name) {
  if (!value) throw new TypeError(`${name} is required`);
}

function parseRtmpUrl(value) {
  required(value, 'RTMP URL');
  const url = new URL(value);
  if (url.protocol !== 'rtmp:') throw new TypeError('Only rtmp:// endpoints are supported');
  const port = Number(url.port || 1935);
  const path = url.pathname.replace(/^\//, '');
  const slash = path.indexOf('/');
  const app = slash < 0 ? path : path.slice(0, slash);
  const stream = slash < 0 ? '' : path.slice(slash + 1);
  if (!app || !stream) throw new TypeError(`RTMP URL requires app and stream: ${value}`);
  return { host: url.hostname, port, app, stream };
}

function encodeAmf0String(value) {
  const b = Buffer.from(String(value));
  const out = Buffer.allocUnsafe(3 + b.length);
  out[0] = 2;
  out.writeUInt16BE(b.length, 1);
  b.copy(out, 3);
  return out;
}

function encodeAmf0Number(value) {
  const out = Buffer.allocUnsafe(9);
  out[0] = 0;
  out.writeDoubleBE(Number(value), 1);
  return out;
}

function encodeAmf0Null() {
  return Buffer.from([5]);
}

function encodeAmf0Object(value) {
  const chunks = [Buffer.from([3])];
  for (const [key, val] of Object.entries(value || {})) {
    const k = Buffer.from(key);
    chunks.push(Buffer.from([k.length >> 8, k.length & 255]), k);
    if (typeof val === 'number') chunks.push(encodeAmf0Number(val));
    else if (typeof val === 'string') chunks.push(encodeAmf0String(val));
    else chunks.push(encodeAmf0Null());
  }
  chunks.push(Buffer.from([0, 0, 9]));
  return Buffer.concat(chunks);
}

function encodeCommand(name, transactionId, args = []) {
  return Buffer.concat([
    encodeAmf0String(name),
    encodeAmf0Number(transactionId),
    ...args
  ]);
}

function readAmf0Value(buffer, offset = 0) {
  const type = buffer[offset++];
  if (type === 0) return { value: buffer.readDoubleBE(offset), next: offset + 8 };
  if (type === 1) return { value: Boolean(buffer[offset++]), next: offset + 1 };
  if (type === 2) {
    const len = buffer.readUInt16BE(offset);
    offset += 2;
    return { value: buffer.subarray(offset, offset + len).toString(), next: offset + len };
  }
  if (type === 5) return { value: null, next: offset };
  if (type === 3) {
    const obj = {};
    while (offset + 3 <= buffer.length) {
      const len = buffer.readUInt16BE(offset);
      offset += 2;
      if (len === 0 && buffer[offset] === 9) return { value: obj, next: offset + 1 };
      const key = buffer.subarray(offset, offset + len).toString();
      offset += len;
      const parsed = readAmf0Value(buffer, offset);
      obj[key] = parsed.value;
      offset = parsed.next;
    }
  }
  return { value: undefined, next: buffer.length };
}

function decodeCommand(buffer) {
  const values = [];
  let offset = 0;
  while (offset < buffer.length) {
    const parsed = readAmf0Value(buffer, offset);
    values.push(parsed.value);
    if (parsed.next <= offset) break;
    offset = parsed.next;
  }
  return values;
}

function makeHandshakeC1() {
  const out = Buffer.alloc(HANDSHAKE_SIZE);
  out.writeUInt32BE(Math.floor(Date.now() / 1000) >>> 0, 0);
  out.writeUInt32BE(0, 4);
  crypto.randomBytes(HANDSHAKE_SIZE - 8).copy(out, 8);
  return out;
}

function encodeBasicHeader(fmt, csid) {
  if (csid < 64) return Buffer.from([(fmt << 6) | csid]);
  if (csid < 320) return Buffer.from([(fmt << 6), csid - 64]);
  const n = csid - 64;
  return Buffer.from([(fmt << 6) | 1, n & 255, (n >> 8) & 255]);
}

function encodeChunkedMessage({ csid = 4, timestamp = 0, type, streamId = 1, payload, chunkSize = DEFAULT_OUT_CHUNK_SIZE }) {
  const parts = [];
  let offset = 0;
  const first = Math.min(chunkSize, payload.length);
  const h = Buffer.allocUnsafe(11);
  const ts = Math.min(timestamp >>> 0, 0xffffff);
  h.writeUIntBE(ts, 0, 3);
  h.writeUIntBE(payload.length, 3, 3);
  h[6] = type;
  h.writeUInt32LE(streamId >>> 0, 7);
  parts.push(encodeBasicHeader(0, csid), h, payload.subarray(0, first));
  offset = first;
  while (offset < payload.length) {
    const n = Math.min(chunkSize, payload.length - offset);
    parts.push(encodeBasicHeader(3, csid), payload.subarray(offset, offset + n));
    offset += n;
  }
  return Buffer.concat(parts);
}

class RtmpChunkDecoder extends EventEmitter {
  constructor({ chunkSize = DEFAULT_CHUNK_SIZE } = {}) {
    super();
    this.buffer = Buffer.alloc(0);
    this.chunkSize = Math.max(1, Number(chunkSize) || DEFAULT_CHUNK_SIZE);
    this.headers = new Map();
    this.messages = new Map();
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const parsed = this.readChunk();
      if (!parsed) return;
      if (parsed.type === 'setChunkSize') this.chunkSize = parsed.size;
      else if (parsed.type === 'message') this.emit('message', parsed.message);
    }
  }

  readChunk() {
    const b = this.buffer;
    if (b.length < 1) return null;

    const first = b[0];
    const fmt = first >> 6;
    let csid = first & 0x3f;
    let pos = 1;

    if (csid === 0) {
      if (b.length < 2) return null;
      csid = 64 + b[1];
      pos = 2;
    } else if (csid === 1) {
      if (b.length < 3) return null;
      csid = 64 + b[1] + (b[2] << 8);
      pos = 3;
    }

    let header = this.headers.get(csid);
    const partial = this.messages.get(csid);

    if (fmt === 0) {
      if (b.length < pos + 11) return null;
      const rawTimestamp = b.readUIntBE(pos, 3);
      const length = b.readUIntBE(pos + 3, 3);
      const type = b[pos + 6];
      const streamId = b.readUInt32LE(pos + 7);
      pos += 11;
      header = {
        timestamp: rawTimestamp,
        delta: 0,
        length,
        type,
        streamId,
        extended: rawTimestamp === 0xffffff
      };
    } else if (!header) {
      return null;
    } else if (fmt === 1) {
      if (b.length < pos + 7) return null;
      const rawDelta = b.readUIntBE(pos, 3);
      const length = b.readUIntBE(pos + 3, 3);
      const type = b[pos + 6];
      pos += 7;
      header = {
        ...header,
        timestamp: header.timestamp + rawDelta,
        delta: rawDelta,
        length,
        type,
        extended: rawDelta === 0xffffff
      };
    } else if (fmt === 2) {
      if (b.length < pos + 3) return null;
      const rawDelta = b.readUIntBE(pos, 3);
      pos += 3;
      header = {
        ...header,
        timestamp: header.timestamp + rawDelta,
        delta: rawDelta,
        extended: rawDelta === 0xffffff
      };
    } else if (!partial) {
      header = {
        ...header,
        timestamp: header.timestamp + header.delta
      };
    }

    if (header.extended) {
      if (b.length < pos + 4) return null;
      const extended = b.readUInt32BE(pos);
      pos += 4;
      if (fmt === 0) {
        header = { ...header, timestamp: extended, extended: false };
      } else if (fmt === 1 || fmt === 2) {
        const previousTimestamp = this.headers.get(csid)?.timestamp ?? 0;
        header = {
          ...header,
          timestamp: previousTimestamp + extended,
          delta: extended,
          extended: false
        };
      } else {
        header = { ...header, extended: false };
      }
    }

    this.headers.set(csid, header);

    const current = partial || { header, payload: Buffer.alloc(0) };
    const remaining = header.length - current.payload.length;
    const take = Math.min(this.chunkSize, remaining);
    if (b.length < pos + take) return null;

    const data = b.subarray(pos, pos + take);
    this.buffer = b.subarray(pos + take);
    current.payload = Buffer.concat([current.payload, data]);
    current.header = header;

    if (current.payload.length === header.length) {
      this.messages.delete(csid);
      return { type: 'message', message: { ...header, payload: current.payload } };
    }

    this.messages.set(csid, current);
    return { type: 'partial' };
  }}

function parseMessageUrl(value) {
  return parseRtmpUrl(value);
}

export async function loadFlvFallbackMedia(file) {
  required(file, 'fallback FLV file');
  const buffer = await readFile(file);
  if (buffer.length < 13 || buffer.subarray(0, 3).toString() !== 'FLV') {
    throw new Error('fallback file must be an FLV container');
  }
  const offset = buffer.readUInt32BE(5);
  let pos = Math.max(9, offset) + 4;
  const tags = [];
  while (pos + 11 <= buffer.length) {
    const type = buffer[pos];
    const dataSize = buffer.readUIntBE(pos + 1, 3);
    const timestamp = buffer.readUIntBE(pos + 4, 3) + (buffer[pos + 7] * 0x1000000);
    const dataStart = pos + 11;
    const dataEnd = dataStart + dataSize;
    if (dataEnd + 4 > buffer.length) break;
    if (type === TYPE_AUDIO || type === TYPE_VIDEO) {
      tags.push({
        type,
        timestamp,
        payload: Buffer.from(buffer.subarray(dataStart, dataEnd))
      });
    }
    pos = dataEnd + 4;
  }

  const firstKeyframe = tags.findIndex(tag =>
    tag.type === TYPE_VIDEO && (tag.payload[0] >> 4) === 1
  );
  if (firstKeyframe < 0) {
    throw new Error('fallback FLV contains no H264 keyframe');
  }

  const ordered = tags.slice(firstKeyframe);
  const nextKeyframe = ordered.findIndex((tag, index) =>
    index > 0 && tag.type === TYPE_VIDEO && (tag.payload[0] >> 4) === 1
  );
  const selected = nextKeyframe > 0 ? ordered.slice(0, nextKeyframe) : ordered;
  const base = selected[0]?.timestamp ?? 0;

  return selected.map((tag, index) => ({
    type: tag.type,
    payload: tag.payload,
    durationMs: index + 1 < selected.length
      ? Math.max(1, selected[index + 1].timestamp - tag.timestamp)
      : Math.max(1, tag.timestamp - base || 40)
  }));
}

export function buildRtmpHandshake() {
  return Buffer.concat([Buffer.from([RTMP_VERSION]), makeHandshakeC1()]);
}

export class RtmpSessionMultiplexer {
  constructor(options = {}) {
    this.engine = createRealZeroStopProxy(options);
  }

  start() {
    return this.engine.start();
  }

  stop() {
    return this.engine.stop();
  }

  status() {
    return this.engine.status();
  }
}

export function createRealZeroStopProxy({
  destination,
  fallbackMedia = [],
  fallbackFile = '',
  ffmpegPath = 'ffmpeg',
  ingestSource = '',
  frameIntervalMs = 40,
  reconnectMs = 1000,
  autoStart = false
} = {}) {
  const dest = parseRtmpUrl(destination);
  const state = {
    status: 'idle',
    downstreamConnected: false,
    ingestConnected: false,
    fallbackActive: true,
    timestamp: 0,
    messages: 0,
    reconnects: 0,
    lastError: null,
    startedAt: null
  };

  let socket = null;
  let ingest = null;
  let stopping = false;
  let timer = null;
  let startPromise = null;
  let transaction = 1;
  let downstreamStreamId = 1;
  let sourceStreamId = 1;
  let destinationConnectTx = 0;
  let destinationCreateTx = 0;
  let sourceConnectTx = 0;
  let sourceCreateTx = 0;
  const outboundChunkSize = DEFAULT_OUT_CHUNK_SIZE;
  let lastMedia = new Map();
  state.lastSourceTimestamp = 0;
  let activeFallbackMedia = Array.isArray(fallbackMedia) ? fallbackMedia : [];
  let fallbackIndex = 0;
  let fallbackTimer = null;
  let ingestDecoder = null;

  const cleanupTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const schedule = fn => {
    cleanupTimer();
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, Math.max(250, Number(reconnectMs) || 1000));
    timer.unref?.();
  };

  const write = data => {
    if (!socket || socket.destroyed) return false;
    return socket.write(data);
  };

  const sendMessage = ({ csid, type, streamId, timestamp, payload }) => {
    if (!write(encodeChunkedMessage({
      csid, type, streamId, timestamp: Math.max(0, Math.floor(timestamp)),
      payload, chunkSize: outboundChunkSize
    }))) return false;
    state.messages++;
    return true;
  };

  const sendConnectSequence = () => {
    const tcUrl = destination;
    destinationConnectTx = transaction++;
    sendMessage({
      csid: 3,
      type: TYPE_AMF0_COMMAND,
      streamId: 0,
      timestamp: 0,
      payload: encodeCommand('connect', destinationConnectTx, [
        encodeAmf0Object({
          app: dest.app,
          tcUrl,
          type: 'nonprivate',
          flashVer: 'FMLE/3.0',
          capabilities: 15,
          audioCodecs: 4071,
          videoCodecs: 252,
          videoFunction: 1
        })
      ])
    });
  };

  const sendPublishSequence = () => {
    destinationCreateTx = transaction++;
    sendMessage({
      csid: 3,
      type: TYPE_AMF0_COMMAND,
      streamId: 0,
      timestamp: 0,
      payload: encodeCommand('createStream', destinationCreateTx, [encodeAmf0Null()])
    });
  };

  const sendPublish = () => {
    sendMessage({
      csid: 4,
      type: TYPE_AMF0_COMMAND,
      streamId: downstreamStreamId,
      timestamp: 0,
      payload: encodeCommand('publish', transaction++, [
        encodeAmf0String(dest.stream),
        encodeAmf0String('live')
      ])
    });
  };

  const handleControl = message => {
    // The peer's Set Chunk Size controls our decoder, not our encoder.
    // RtmpChunkDecoder owns the inbound chunk-size state.
  };

  const handleCommand = message => {
    const values = decodeCommand(message.payload);
    const name = values[0];
    const tx = Number(values[1]);
    if (name === '_result' && tx === destinationConnectTx) {
      sendPublishSequence();
      return;
    }
    if (name === '_result' && tx === destinationCreateTx) {
      const streamId = Number(values[3]);
      if (Number.isFinite(streamId) && streamId > 0) downstreamStreamId = streamId;
      sendPublish();
    }
  };

  const forwardMedia = message => {
    if (message.type !== TYPE_AUDIO && message.type !== TYPE_VIDEO && message.type !== TYPE_AMF0_DATA) return;
    if (message.type === TYPE_AUDIO || message.type === TYPE_VIDEO) {
      if (state.fallbackActive) {
        state.fallbackActive = false;
        stopFallbackLoop();
      }
      lastMedia.set(message.type, Buffer.from(message.payload));
    }
    const sourceTimestamp = Number(message.timestamp) || 0;
    state.timestamp = Math.max(state.timestamp + 1, state.timestamp + Math.max(0, sourceTimestamp - (state.lastSourceTimestamp ?? sourceTimestamp)));
    state.lastSourceTimestamp = sourceTimestamp;
    sendMessage({
      csid: message.type === TYPE_VIDEO ? 6 : 7,
      type: message.type,
      streamId: downstreamStreamId,
      timestamp: state.timestamp,
      payload: message.payload
    });
  };

  const sendFallbackFrame = () => {
    if (!state.downstreamConnected || !activeFallbackMedia.length || stopping) return;
    const item = activeFallbackMedia[fallbackIndex++ % activeFallbackMedia.length];
    if (!item?.payload || !Number.isFinite(item.type)) return;
    state.timestamp += Math.max(1, Number(item.durationMs) || frameIntervalMs);
    sendMessage({
      csid: item.type === TYPE_VIDEO ? 6 : 7,
      type: item.type,
      streamId: downstreamStreamId,
      timestamp: state.timestamp,
      payload: Buffer.isBuffer(item.payload) ? item.payload : Buffer.from(item.payload)
    });
  };

  const startFallbackLoop = () => {
    if (fallbackTimer || !activeFallbackMedia.length) return;
    fallbackTimer = setInterval(sendFallbackFrame, Math.max(10, Number(frameIntervalMs) || 40));
    fallbackTimer.unref?.();
  };

  const stopFallbackLoop = () => {
    if (fallbackTimer) clearInterval(fallbackTimer);
    fallbackTimer = null;
  };

  const connectDestination = () => {
    const s = net.createConnection({ host: dest.host, port: dest.port });
    socket = s;
    state.status = 'connecting';
    let handshake = Buffer.alloc(0);
    let stage = 0;
    let decoder = new RtmpChunkDecoder();

    s.on('connect', () => {
      write(buildRtmpHandshake());
    });

    s.on('data', chunk => {
      handshake = Buffer.concat([handshake, chunk]);
      if (stage === 0 && handshake.length >= 1 + HANDSHAKE_SIZE * 2) {
        write(handshake.subarray(1, 1 + HANDSHAKE_SIZE));
        handshake = handshake.subarray(1 + HANDSHAKE_SIZE * 2);
        stage = 1;
        state.downstreamConnected = true;
        state.status = 'running';
        sendConnectSequence();
        startFallbackLoop();
      }
      if (stage === 1 && handshake.length) {
        decoder.push(handshake);
        handshake = Buffer.alloc(0);
      }
    });

    decoder.on('message', message => {
      handleControl(message);
      if (message.type === TYPE_AMF0_COMMAND) handleCommand(message);
    });

    s.on('error', error => {
      state.lastError = String(error.message).slice(-2000);
    });

    s.on('close', () => {
      if (socket !== s) return;
      state.downstreamConnected = false;
      socket = null;
      if (!stopping) {
        state.reconnects++;
        schedule(connectDestination);
      }
    });
  };

  const sendSourceConnect = () => {
    sourceConnectTx = transaction++;
    const input = parseMessageUrl(ingestSource);
    const tcUrl = ingestSource;
    if (!ingest) return;
    ingest.write(encodeChunkedMessage({
      csid: 3,
      type: TYPE_AMF0_COMMAND,
      streamId: 0,
      timestamp: 0,
      payload: encodeCommand('connect', sourceConnectTx, [
        encodeAmf0Object({ app: input.app, tcUrl, type: 'nonprivate', flashVer: 'APEX/1.0', capabilities: 15, audioCodecs: 4071, videoCodecs: 252, videoFunction: 1 })
      ])
    }));
  };

  const sendSourceCreateStream = () => {
    sourceCreateTx = transaction++;
    if (!ingest) return;
    ingest.write(encodeChunkedMessage({
      csid: 3,
      type: TYPE_AMF0_COMMAND,
      streamId: 0,
      timestamp: 0,
      payload: encodeCommand('createStream', sourceCreateTx, [encodeAmf0Null()])
    }));
  };

  const sendSourcePlay = () => {
    const input = parseMessageUrl(ingestSource);
    if (!ingest) return;
    ingest.write(encodeChunkedMessage({
      csid: 8,
      type: TYPE_AMF0_COMMAND,
      streamId: sourceStreamId,
      timestamp: 0,
      payload: encodeCommand('play', transaction++, [encodeAmf0String(input.stream)])
    }));
  };

  const handleSourceCommand = message => {
    const values = decodeCommand(message.payload);
    const name = values[0];
    const tx = Number(values[1]);
    if (name === '_result' && tx === sourceConnectTx) {
      sendSourceCreateStream();
      return;
    }
    if (name === '_result' && tx === sourceCreateTx) {
      const streamId = Number(values[3]);
      if (Number.isFinite(streamId) && streamId > 0) sourceStreamId = streamId;
      sendSourcePlay();
    }
  };

  const connectIngest = () => {
    if (!ingestSource || ingest || stopping) return;
    const input = parseMessageUrl(ingestSource);
    const s = net.createConnection({ host: input.host, port: input.port });
    ingest = s;
    let handshake = Buffer.alloc(0);
    let stage = 0;
    ingestDecoder = new RtmpChunkDecoder();

    s.on('connect', () => {
      s.write(buildRtmpHandshake());
    });

    s.on('data', chunk => {
      handshake = Buffer.concat([handshake, chunk]);
      if (stage === 0 && handshake.length >= 1 + HANDSHAKE_SIZE * 2) {
        s.write(handshake.subarray(1, 1 + HANDSHAKE_SIZE));
        handshake = handshake.subarray(1 + HANDSHAKE_SIZE * 2);
        stage = 1;
        state.ingestConnected = true;
        sendSourceConnect();
      }
      if (stage === 1 && handshake.length) {
        ingestDecoder.push(handshake);
        handshake = Buffer.alloc(0);
      }
    });

    ingestDecoder.on('message', message => {
      if (message.type === TYPE_AMF0_COMMAND) handleSourceCommand(message);
      forwardMedia(message);
    });
    s.on('error', error => {
      state.lastError = String(error.message).slice(-2000);
    });
    s.on('close', () => {
      if (ingest !== s) return;
      ingest = null;
      state.ingestConnected = false;
      if (!stopping) schedule(connectIngest);
    });
  };

  const start = async () => {
    if (startPromise) return startPromise;
    startPromise = Promise.resolve().then(() => {
      stopping = false;
      if (fallbackFile && !activeFallbackMedia.length) {
        activeFallbackMedia = await loadFlvFallbackMedia(fallbackFile);
        fallbackIndex = 0;
      }
      if (state.status === 'running' || socket) return status();
      if (fallbackFile && !activeFallbackMedia.length) {
        activeFallbackMedia = await loadFlvFallbackMedia(fallbackFile);
      }
      if (!activeFallbackMedia.length) throw new Error('zero-stop relay requires fallback media');
      state.startedAt ||= new Date().toISOString();
      state.status = 'starting';
      connectDestination();
      connectIngest();
      return status();
    }).finally(() => { startPromise = null; });
    return startPromise;
  };

  const stop = () => {
    stopping = true;
    cleanupTimer();
    stopFallbackLoop();
    if (ingest) ingest.destroy();
    if (socket) socket.destroy();
    ingest = null;
    socket = null;
    state.ingestConnected = false;
    state.downstreamConnected = false;
    state.status = 'stopped';
    return status();
  };

  const status = () => ({
    ...state,
    multiplexer: true,
    protocolState: {
      downstream: state.downstreamConnected ? 'connected' : 'disconnected',
      ingest: state.ingestConnected ? 'connected' : 'disconnected',
      sourceMode: state.fallbackActive ? 'standby' : 'live',
      timestampMs: state.timestamp
    },
    configured: Boolean(destination),
    ingestConfigured: Boolean(ingestSource),
    fallbackConfigured: activeFallbackMedia.length > 0,
    fallbackFile: fallbackFile || null,
    persistentDownstream: true,
    protocol: 'rtmp'
  });

  if (autoStart) void start();

  return { start, stop, status };
}

export { RtmpChunkDecoder, encodeChunkedMessage, parseRtmpUrl };
