import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

export const APEX_APPS = Object.freeze([
  'KernelVision', 'XShield', 'Kernelodies', 'PlanetApeX', 'KashKorner', 'KoinKob'
]);
const APP_SET = new Set(APEX_APPS);
const MAX_BODY = 16 * 1024 * 1024;
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

/** Authenticated API-to-peer-runtime IPC with six fixed, isolated CAS instances. */
export function createPeerStorageApiBridge({ stores, tokens, socketPath = '/tmp/apex-storage-api.sock' } = {}) {
  if (!stores || typeof stores !== 'object') throw new TypeError('six app-scoped peer stores are required');
  for (const app of APEX_APPS) {
    const entry = stores[app];
    if (entry?.cas?.namespace !== app || entry?.objects?.namespace !== app ||
        !['readRef', 'writeRef', 'listRefs', 'deleteRef'].every(name => typeof entry.cas[name] === 'function') ||
        !['putBlob', 'getBlob'].every(name => typeof entry.objects[name] === 'function')) {
      throw new Error('missing or incorrectly scoped peer store: ' + app);
    }
  }
  if (!tokens || typeof tokens !== 'object') throw new TypeError('per-app bridge tokens are required');
  for (const app of APEX_APPS) if (typeof tokens[app] !== 'string' || tokens[app].length < 32) throw new TypeError('missing per-app bridge token: ' + app);
  if (typeof socketPath !== 'string' || !socketPath.startsWith('/tmp/') || socketPath.includes('..')) {
    throw new TypeError('bridge socket must be a safe path under /tmp');
  }
  const expected = Object.fromEntries(APEX_APPS.map(app => [app, Buffer.from(tokens[app])]));
  const server = createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.method !== 'POST' || req.url !== '/v1/storage') return send(404, { error: 'not found' });
      const body = await readBody(req);
      if (!APP_SET.has(body.app)) return send(403, { error: 'unknown app namespace' });
      const authorization = String(req.headers.authorization || '');
      const actual = Buffer.from(authorization.startsWith('Bearer ') ? authorization.slice(7) : '');
      const appToken = expected[body.app];
      if (actual.length !== appToken.length || !timingSafeEqual(actual, appToken)) return send(401, { error: 'unauthorized' });
      const { cas, objects } = stores[body.app];
      const args = body.args || {};
      let result;
      switch (body.operation) {
        case 'readRef':
          if (!safeKey(args.namespace) || !safeKey(args.key)) return send(400, { error: 'invalid reference key' });
          result = await cas.readRef(args.namespace, args.key);
          break;
        case 'writeRef':
          if (!safeKey(args.namespace) || !safeKey(args.key) || !Object.hasOwn(args, 'value')) return send(400, { error: 'invalid reference write' });
          result = await cas.writeRef(args.namespace, args.key, args.value, { expectedHash: args.expectedHash ?? null });
          break;
        case 'listRefs':
          if (!safeKey(args.namespace)) return send(400, { error: 'invalid reference namespace' });
          result = await cas.listRefs(args.namespace);
          break;
        case 'deleteRef':
          if (!safeKey(args.namespace) || !safeKey(args.key)) return send(400, { error: 'invalid reference deletion' });
          result = await cas.deleteRef(args.namespace, args.key, { expectedHash: args.expectedHash ?? null });
          break;
        case 'putBlob': {
          if (typeof args.bytesBase64 !== 'string' || args.bytesBase64.length > 12 * 1024 * 1024) return send(413, { error: 'invalid or oversized blob' });
          const bytes = Buffer.from(args.bytesBase64, 'base64');
          if (bytes.toString('base64') !== args.bytesBase64) return send(400, { error: 'invalid blob encoding' });
          result = await objects.putBlob(bytes);
          break;
        }
        case 'getBlob':
          if (typeof args.hash !== 'string' || !/^[a-f0-9]{64}$/.test(args.hash)) return send(400, { error: 'invalid blob hash' });
          result = { bytesBase64: Buffer.from(await objects.getBlob(args.hash)).toString('base64') };
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
