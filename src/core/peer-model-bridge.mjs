import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const safeId = value => typeof value === 'string' && value.length <= 256 &&
  value.split('/').every(part => /^[A-Za-z0-9._-]{1,128}$/.test(part));

/**
 * Loopback-only, in-memory HTTP/IPC adapter from vLLM to an already-authorized
 * PeerContentAddressedStore. It never persists model bytes or proxies providers.
 * The hosting daemon must pass its live store and app-specific authorization.
 */
export function createPeerModelBridgeServer({ store, authorizeModel, token, host = '127.0.0.1', port = 8765, socketPath = '' } = {}) {
  if (!store || typeof store.readRef !== 'function' || typeof store.getBlob !== 'function') {
    throw new TypeError('live PeerContentAddressedStore is required');
  }
  if (typeof authorizeModel !== 'function') throw new TypeError('model authorization policy is required');
  if (typeof token !== 'string' || token.length < 32) throw new TypeError('bridge token must be at least 32 characters');
  if (!socketPath && host !== '127.0.0.1' && host !== '::1') throw new Error('model bridge must bind to loopback only');
  if (socketPath && (typeof socketPath !== 'string' || !socketPath.startsWith('/tmp/') || socketPath.includes('..'))) {
    throw new Error('Unix socket path must be a safe path under /tmp');
  }
  const expected = Buffer.from(token);
  const send = (res, status, body, type = 'application/json') => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(body);
  };
  const server = createServer(async (req, res) => {
    try {
      const supplied = String(req.headers.authorization || '').replace(/^Bearer /, '');
      const actual = Buffer.from(supplied);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return send(res, 401, 'unauthorized');
      if (req.method !== 'GET') return send(res, 405, 'method not allowed');
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const match = url.pathname.match(/^\/v1\/peer-cas\/models\/([^/]+)\/(.+)\/manifest$/);
      if (match) {
        const modelId = decodeURIComponent(match[1]), revision = decodeURIComponent(match[2]);
        if (!safeId(modelId) || !safeId(revision)) return send(res, 400, 'invalid model identity');
        if (await authorizeModel({ namespace: store.namespace, modelId, revision }) !== true) return send(res, 403, 'forbidden');
        const ref = await store.readRef(`model-bundle.v1/${modelId}/${revision}`);
        const bundle = ref?.value;
        if (!bundle || bundle.kind !== 'apex.model-bundle.v1' || bundle.namespace !== store.namespace ||
            bundle.modelId !== modelId || bundle.revision !== revision || !Array.isArray(bundle.files)) {
          return send(res, 404, 'model bundle not found');
        }
        return send(res, 200, JSON.stringify({ namespace: bundle.namespace, model_id: modelId,
          revision, files: bundle.files.map(({ path, sha256, size }) => ({ path, sha256, size })) }));
      }
      const blobMatch = url.pathname.match(/^\/v1\/peer-cas\/blobs\/([a-f0-9]{64})$/);
      if (blobMatch) {
        const modelId = url.searchParams.get('model_id'), revision = url.searchParams.get('revision');
        if (!safeId(modelId) || !safeId(revision) ||
            await authorizeModel({ namespace: store.namespace, modelId, revision }) !== true) return send(res, 403, 'forbidden');
        const ref = await store.readRef(`model-bundle.v1/${modelId}/${revision}`);
        const file = ref?.value?.files?.find(item => item.sha256 === blobMatch[1]);
        if (!file) return send(res, 404, 'blob not in authorized bundle');
        const bytes = Buffer.from(await store.getBlob(file.blobManifestHash));
        if (bytes.length !== file.size || hash(bytes) !== file.sha256) throw new Error('peer blob integrity failure');
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        for (let offset = 0; offset < bytes.length; offset += 32 * 1024) {
          if (!res.write(bytes.subarray(offset, Math.min(offset + 32 * 1024, bytes.length)))) {
            await new Promise(resolve => res.once('drain', resolve));
          }
        }
        return res.end();
      }
      return send(res, 404, 'not found');
    } catch {
      return send(res, 502, 'peer-cas request failed closed');
    }
  });
  return { server, listen: () => new Promise((resolve, reject) => {
    server.once('error', reject);
    if (socketPath) server.listen(socketPath, () => resolve({ socketPath }));
    else server.listen(port, host, () => resolve(server.address()));
  }), close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
