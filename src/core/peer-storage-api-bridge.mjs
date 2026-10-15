import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

export const APEX_APPS = Object.freeze([
  'KernelVision', 'XShield', 'Kernelodies', 'PlanetApeX', 'KashKorner', 'KoinKob'
]);
const APP_SET = new Set(APEX_APPS);
const MAX_BODY = 1024 * 1024;
const safeKey = value => typeof value === 'string' && value.length > 0 &&
  value.length <= 512 && !value.split('/').some(part => part === '.' || part === '..');

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('bridge request too large'), { statusCode: 413 }));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('invalid bridge request'), { statusCode: 400 })); }
    });
    req.on('error', reject);
  });
}

/**
 * Authenticated API-to-peer-runtime IPC. The caller names an app, but the
 * server can only resolve it to that app's separately constructed peer store.
 * No local persistence, remote object-store, or fallback path exists here.
 */
export function createPeerStorageApiBridge({ stores, token, socketPath = '/tmp/apex-storage-api.sock' } = {}) {
  if (!stores || typeof stores !== 'object') throw new TypeError('six app-scoped peer stores are required');
  for (const app of APEX_APPS) {
    const store = stores[app];
    if (!store || store.namespace !== app ||
        !['readRef', 'writeRef', 'listRefs', 'putBlob', 'getBlob'].every(name => typeof store[name] === 'function')) {
      throw new Error('missing or incorrectly scoped peer store: ' + app);
    }
  }
  if (typeof token !== 'string' || token.length < 32) throw new TypeError('bridge token must be at least 32 characters');
  if (typeof socketPath !== 'string' || !socketPath.startsWith('/tmp/') || socketPath.includes('..')) {
    throw new TypeError('bridge socket must be a safe path under /tmp');
  }
  const expected = Buffer.from(token);
  const server = createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(JSON.stringify(body));
    };
    try {
      const actual = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer /, ''));
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return send(401, { error: 'unauthorized' });
      if (req.method !== 'POST' || req.url !== '/v1/storage') return send(404, { error: 'not found' });
      const body = await readBody(req);
      if (!APP_SET.has(body.app)) return send(403, { error: 'unknown app namespace' });
      const store = stores[body.app];
      const args = body.args || {};
      let result;
      switch (body.operation) {
        case 'readRef':
          if (!safeKey(args.key)) return send(400, { error: 'invalid reference key' });
          result = await store.readRef(args.key);
          break;
        case 'writeRef':
          if (!safeKey(args.key) || !Object.hasOwn(args, 'value')) return send(400, { error: 'invalid reference write' });
          result = await store.writeRef(args.key, args.value, { expectedHash: args.expectedHash ?? null });
          break;
        case 'listRefs':
          result = await store.listRefs();
          break;
        case 'putBlob': {
          if (typeof args.bytesBase64 !== 'string' || args.bytesBase64.length > 12 * 1024 * 1024) return send(413, { error: 'invalid or oversized blob' });
          const bytes = Buffer.from(args.bytesBase64, 'base64');
          if (bytes.toString('base64') !== args.bytesBase64) return send(400, { error: 'invalid blob encoding' });
          result = await store.putBlob(bytes);
          break;
        }
        case 'getBlob':
          if (typeof args.hash !== 'string' || !/^[a-f0-9]{64}$/.test(args.hash)) return send(400, { error: 'invalid blob hash' });
          result = { bytesBase64: Buffer.from(await store.getBlob(args.hash)).toString('base64') };
          break;
        default:
          return send(403, { error: 'operation not allowed' });
      }
      return send(200, { ok: true, app: body.app, result });
    } catch (error) {
      return send(Number(error?.statusCode) || 503, { error: 'peer storage operation failed closed' });
    }
  });
  return {
    server,
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, async () => {
        try {
          const { chmod } = await import('node:fs/promises');
          await chmod(socketPath, 0o600);
          resolve({ socketPath });
        } catch (error) { server.close(() => reject(error)); }
      });
    }),
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  };
}
