import http from 'node:http';

const APPS = new Set(['KernelVision', 'XShield', 'Kernelodies', 'PlanetApeX', 'KashKorner', 'KoinKob']);

function rpc({ socketPath, token, app, operation, args = {} }) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify({ app, operation, args }));
    const req = http.request({
      socketPath, path: '/v1/storage', method: 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'application/json',
        'content-length': payload.length
      },
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

/**
 * API-side fixed-namespace client. A caller creates one instance per trusted
 * app context; the namespace is immutable and cannot be supplied per request.
 */
export class PeerStorageApiClient {
  constructor({ app, token = process.env.APEX_PEER_STORAGE_API_TOKEN,
    socketPath = process.env.APEX_PEER_STORAGE_API_SOCKET || '/tmp/apex-storage-api.sock' } = {}) {
    if (!APPS.has(app)) throw new TypeError('a canonical app namespace is required');
    if (typeof token !== 'string' || token.length < 32) throw new TypeError('peer storage bridge token must be at least 32 characters');
    if (typeof socketPath !== 'string' || !socketPath.startsWith('/tmp/') || socketPath.includes('..')) {
      throw new TypeError('peer storage bridge socket must be a safe path under /tmp');
    }
    this.namespace = app;
    this.app = app;
    this.token = token;
    this.socketPath = socketPath;
  }

  readRef(key) {
    return rpc({ ...this, operation: 'readRef', args: { key } });
  }

  writeRef(key, value, { expectedHash = null } = {}) {
    return rpc({ ...this, operation: 'writeRef', args: { key, value, expectedHash } });
  }

  listRefs() {
    return rpc({ ...this, operation: 'listRefs' });
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
