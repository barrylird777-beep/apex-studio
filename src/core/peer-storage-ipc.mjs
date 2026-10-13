import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { encodeCanonical, decodeCanonical } from './apex-cbor.mjs';

const MAX_BODY_BYTES = Math.max(1024 * 1024, Number(process.env.APEX_PEER_STORAGE_IPC_MAX_BYTES || 64 * 1024 * 1024));
const TOKEN_HEADER = 'x-apex-peer-storage-token';

function tokenMatches(expected, actual) {
  const a = Buffer.from(String(expected || ''));
  const b = Buffer.from(String(actual || ''));
  return a.length >= 32 && a.length === b.length && timingSafeEqual(a, b);
}

async function readBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw Object.assign(new Error('peer storage IPC body exceeds configured limit'), { status: 413 });
    chunks.push(chunk);
  }
  if (!total) throw Object.assign(new Error('empty peer storage IPC request'), { status: 400 });
  return decodeCanonical(Buffer.concat(chunks, total));
}

/** Private loopback-only bridge from HTTP API process to the libp2p-owning daemon. */
export function createPeerStorageIpcServer({ mediaStore, token, port = Number(process.env.APEX_PEER_STORAGE_BRIDGE_PORT || 18743), host = '127.0.0.1' } = {}) {
  if (!mediaStore || !Array.isArray(mediaStore.apps) ||
      typeof mediaStore.saveAsset !== 'function' || typeof mediaStore.getAsset !== 'function' ||
      typeof mediaStore.getProject !== 'function') throw new TypeError('peer media store is required for IPC bridge');
  if (host !== '127.0.0.1' && host !== '::1') throw new Error('peer storage IPC must bind to loopback only');
  if (typeof token !== 'string' || Buffer.byteLength(token) < 32) throw new Error('peer storage IPC requires a random secret of at least 32 bytes');
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || request.url !== '/v1/media') {
        response.writeHead(404).end();
        return;
      }
      if (!tokenMatches(token, request.headers[TOKEN_HEADER])) {
        response.writeHead(401).end();
        return;
      }
      const envelope = await readBody(request);
      if (!envelope || envelope.version !== 1 || typeof envelope.operation !== 'string' || !envelope.payload) {
        throw Object.assign(new Error('invalid peer storage IPC envelope'), { status: 400 });
      }
      const p = envelope.payload;
      let result;
      switch (envelope.operation) {
        case 'saveAsset':
          if (!Buffer.isBuffer(p.bytes)) throw Object.assign(new Error('asset bytes must use binary CBOR'), { status: 400 });
          result = await mediaStore.saveAsset(p.app, p.projectId, p.assetId, p.bytes, {
            contentType: p.contentType, metadata: p.metadata
          });
          break;
        case 'getAsset':
          result = await mediaStore.getAsset(p.app, p.projectId, p.assetId);
          break;
        case 'getProject':
          result = await mediaStore.getProject(p.app, p.projectId);
          break;
        default:
          throw Object.assign(new Error('unsupported peer storage IPC operation'), { status: 400 });
      }
      const bytes = encodeCanonical({ version: 1, ok: true, result: result ?? null });
      response.writeHead(200, { 'content-type': 'application/cbor', 'content-length': bytes.length, 'cache-control': 'no-store' });
      response.end(bytes);
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      const bytes = encodeCanonical({ version: 1, ok: false, error: String(error?.message || 'peer storage IPC failure'), code: String(error?.code || 'PEER_STORAGE_IPC_ERROR') });
      if (!response.headersSent) response.writeHead(status, { 'content-type': 'application/cbor', 'content-length': bytes.length, 'cache-control': 'no-store' });
      response.end(bytes);
    }
  });
  return Object.freeze({
    server,
    async listen() {
      await new Promise((resolve, reject) => {
        const onError = error => { server.off('listening', onListen); reject(error); };
        const onListen = () => { server.off('error', onError); resolve(); };
        server.once('error', onError);
        server.once('listening', onListen);
        server.listen(port, host);
      });
      return server.address();
    },
    async close() {
      if (!server.listening) return;
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
}

/** Client-side media-store facade. It carries binary CBOR over loopback, never JSON. */
export function createPeerStorageIpcClient({
  token,
  port = Number(process.env.APEX_PEER_STORAGE_BRIDGE_PORT || 18743),
  host = '127.0.0.1',
  fetchImpl = globalThis.fetch
} = {}) {
  if (host !== '127.0.0.1' && host !== '::1') throw new Error('peer storage IPC client must target loopback only');
  if (typeof token !== 'string' || Buffer.byteLength(token) < 32) throw new Error('peer storage IPC requires a random secret of at least 32 bytes');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
  async function call(operation, payload) {
    const body = encodeCanonical({ version: 1, operation, payload });
    if (body.length > MAX_BODY_BYTES) throw new Error('peer storage IPC request exceeds configured limit');
    const response = await fetchImpl(`http://${host}:${port}/v1/media`, {
      method: 'POST',
      headers: { 'content-type': 'application/cbor', [TOKEN_HEADER]: token },
      body
    });
    const responseBytes = Buffer.from(await response.arrayBuffer());
    if (!responseBytes.length) throw new Error('peer storage IPC returned an empty response');
    const envelope = decodeCanonical(responseBytes);
    if (!response.ok || envelope?.ok !== true || envelope.version !== 1) {
      throw Object.assign(new Error(String(envelope?.error || `peer storage IPC failed with HTTP ${response.status}`)), {
        code: String(envelope?.code || 'PEER_STORAGE_IPC_ERROR'), status: response.status
      });
    }
    return envelope.result;
  }
  return Object.freeze({
    apps: Object.freeze(['PlanetApeX', 'XShield', 'KernelVision', 'Kernelodies', 'KashKorner', 'KoinKob']),
    saveAsset: (app, projectId, assetId, bytes, options = {}) => call('saveAsset', {
      app, projectId, assetId, bytes: Buffer.from(bytes), contentType: options.contentType, metadata: options.metadata ?? {}
    }),
    async getAsset(app, projectId, assetId) {
      const result = await call('getAsset', { app, projectId, assetId });
      if (result?.bytes && !Buffer.isBuffer(result.bytes)) result.bytes = Buffer.from(result.bytes);
      return result;
    },
    getProject: (app, projectId) => call('getProject', { app, projectId })
  });
}
