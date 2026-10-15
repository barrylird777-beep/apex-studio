import http from 'node:http';

const APPS = new Set(['KernelVision', 'XShield', 'Kernelodies', 'PlanetApeX', 'KashKorner', 'KoinKob']);

function rpc({ socketPath, token, app, operation, args = {} }) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify({ app, operation, args }));
    const req = http.request({
      socketPath, path: '/v1/storage', method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'content-length': payload.length },
      timeout: 30000
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { return reject(new Error('peer storage bridge returned an invalid response')); }
        if (res.statusCode !== 200 || body?.ok !== true || body.app !== app) {
          return reject(new Error('peer storage bridge rejected the operation; no fallback is permitted'));
        }
        resolve(body.result);
      });
    });
    req.on('timeout', () => req.destroy(new Error('peer storage bridge timed out')));
    req.on('error', reject);
    req.end(payload);
  });
}

/** Fixed app identity: callers cannot change the app namespace per operation. */
export class PeerStorageApiClient {
  constructor({ app = process.env.APEX_APP_NAMESPACE, token = process.env['APEX_PEER_STORAGE_API_TOKEN_' + String(app || '').toUpperCase()],
    socketPath = process.env.APEX_PEER_STORAGE_API_SOCKET || '/tmp/apex-storage-api.sock' } = {}) {
    if (!APPS.has(app)) throw new TypeError('APEX_APP_NAMESPACE must name one canonical app');
    if (typeof token !== 'string' || token.length < 32) throw new TypeError('app-scoped peer storage bridge token must be at least 32 characters');
    if (typeof socketPath !== 'string' || !socketPath.startsWith('/tmp/') || socketPath.includes('..')) {
      throw new TypeError('peer storage bridge socket must be a safe path under /tmp');
    }
    this.namespace = app;
    this.app = app;
    this.token = token;
    this.socketPath = socketPath;
  }

  async init() { await this.listRefs('system'); return this; }

  readRef(namespace, key) {
    return rpc({ ...this, operation: 'readRef', args: { namespace, key } });
  }

  writeRef(namespace, key, value, { expectedHash = null } = {}) {
    return rpc({ ...this, operation: 'writeRef', args: { namespace, key, value, expectedHash } });
  }

  listRefs(namespace) {
    return rpc({ ...this, operation: 'listRefs', args: { namespace } });
  }

  deleteRef(namespace, key, { expectedHash = null } = {}) {
    return rpc({ ...this, operation: 'deleteRef', args: { namespace, key, expectedHash } });
  }

  async putBlob(bytes) {
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    return rpc({ ...this, operation: 'putBlob', args: { bytesBase64: buffer.toString('base64') } });
  }

  async getBlob(hash) {
    const result = await rpc({ ...this, operation: 'getBlob', args: { hash } });
    const bytes = Buffer.from(String(result?.bytesBase64 || ''), 'base64');
    if (bytes.toString('base64') !== result?.bytesBase64) throw new Error('peer blob response encoding verification failed');
    return bytes;
  }
}
