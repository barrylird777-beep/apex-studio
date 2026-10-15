import http from 'node:http';
import { createHash } from 'node:crypto';

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
          const error = new Error('peer storage bridge rejected the operation; no fallback is permitted');
          if (['CAS_CONFLICT', 'INSUFFICIENT_REPLICAS', 'OBJECT_UNAVAILABLE', 'REPAIR_INCOMPLETE'].includes(body?.code)) error.code = body.code;
          return reject(error);
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
  constructor({ app = process.env.APEX_APP_NAMESPACE, token = undefined,
    socketPath = process.env.APEX_PEER_STORAGE_API_SOCKET || '/tmp/apex-storage-api.sock' } = {}) {
    const configuredApp = String(process.env.APEX_APP_NAMESPACE || '');
    if (!APPS.has(configuredApp) || app !== configuredApp) {
      throw new TypeError('API process must use its configured canonical app namespace; per-request app switching is forbidden');
    }
    token = token || process.env['APEX_PEER_STORAGE_API_TOKEN_' + configuredApp.toUpperCase()];
    if (typeof token !== 'string' || token.length < 32) throw new TypeError('app-scoped peer storage bridge token must be at least 32 characters');
    if (typeof socketPath !== 'string' || !socketPath.startsWith('/tmp/') || socketPath.includes('..')) {
      throw new TypeError('peer storage bridge socket must be a safe path under /tmp');
    }
    Object.defineProperties(this, {
      namespace: { value: configuredApp, enumerable: true },
      app: { value: configuredApp, enumerable: true },
      token: { value: token },
      socketPath: { value: socketPath, enumerable: true }
    });
  }

  async init() { await this.listRefs('system'); return this; }

  readRef(namespace, key) {
    return rpc({ ...this, operation: 'readRef', args: { namespace, key } });
  }

  async writeRef(namespace, key, value, options = {}) {
    if (Object.hasOwn(options, 'expectedHash')) {
      return rpc({ ...this, operation: 'writeRef', args: { namespace, key, value, expectedHash: options.expectedHash } });
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await this.readRef(namespace, key);
      try {
        return await rpc({ ...this, operation: 'writeRef',
          args: { namespace, key, value, expectedHash: current?.hash ?? null } });
      } catch (error) {
        if (error.code !== 'CAS_CONFLICT' || attempt === 7) throw error;
      }
    }
    throw new Error('peer API reference CAS retries exhausted');
  }

  listRefs(namespace) {
    return rpc({ ...this, operation: 'listRefs', args: { namespace } });
  }

  deleteRef(namespace, key, { expectedHash = null } = {}) {
    return rpc({ ...this, operation: 'deleteRef', args: { namespace, key, expectedHash } });
  }

  async putBlob(bytes) {
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    if (!buffer.length) throw new TypeError('cannot store an empty asset');
    const digest = createHash('sha256').update(buffer).digest('hex');
    const existing = await this.readRef('asset-manifests', digest);
    if (existing?.value?.kind === 'apex.api.asset-manifest.v1' &&
        existing.value.namespace === this.namespace && existing.value.sha256 === digest &&
        existing.value.bytes === buffer.length) {
      const recovered = await this.getBlob(digest);
      if (!recovered.equals(buffer)) throw new Error('existing peer asset failed deduplication integrity verification');
      return { hash: digest, bytes: buffer.length, contentSha256: digest, namespace: this.namespace, deduplicated: true };
    }
    const chunks = [];
    const chunkSize = 512 * 1024;
    for (let offset = 0; offset < buffer.length; offset += chunkSize) {
      const piece = buffer.subarray(offset, Math.min(offset + chunkSize, buffer.length));
      const stored = await rpc({ ...this, operation: 'putBlob', args: { bytesBase64: piece.toString('base64') } });
      if (!stored?.hash || !/^[a-f0-9]{64}$/.test(stored.hash)) throw new Error('peer did not return a valid chunk manifest hash');
      chunks.push({ hash: stored.hash, bytes: piece.length, sha256: createHash('sha256').update(piece).digest('hex') });
    }
    const manifest = { version: 1, kind: 'apex.api.asset-manifest.v1', namespace: this.namespace,
      sha256: digest, bytes: buffer.length, chunks };
    try {
      await this.writeRef('asset-manifests', digest, manifest, { expectedHash: existing?.hash ?? null });
    } catch (error) {
      if (error.code !== 'CAS_CONFLICT') throw error;
      const raced = await this.readRef('asset-manifests', digest);
      if (raced?.value?.sha256 !== digest || raced.value.bytes !== buffer.length) throw error;
    }
    return { hash: digest, bytes: buffer.length, contentSha256: digest, namespace: this.namespace, replicasVerifiedPerChunk: true };
  }

  async getBlob(hash) {
    if (!/^[a-f0-9]{64}$/.test(String(hash))) throw new TypeError('invalid asset hash');
    const ref = await this.readRef('asset-manifests', hash);
    if (!ref?.value || ref.value.kind !== 'apex.api.asset-manifest.v1' ||
        ref.value.namespace !== this.namespace || ref.value.sha256 !== hash ||
        !Number.isSafeInteger(ref.value.bytes) || !Array.isArray(ref.value.chunks)) {
      throw new Error('peer asset manifest is missing or invalid');
    }
    const descriptors = ref.value.chunks;
    if (descriptors.some(item => !item || !/^[a-f0-9]{64}$/.test(String(item.hash || '')) ||
        !Number.isSafeInteger(item.bytes) || item.bytes < 1 ||
        !/^[a-f0-9]{64}$/.test(String(item.sha256 || '')))) {
      throw new Error('invalid asset chunk descriptor');
    }
    // Bounded parallelism keeps multiple peer streams active without unbounded
    // memory or connection pressure. Results remain in manifest order.
    const configured = Number(process.env.APEX_PEER_STORAGE_FETCH_CONCURRENCY || 8);
    const concurrency = Math.max(1, Math.min(32, Number.isSafeInteger(configured) ? configured : 8));
    const parts = new Array(descriptors.length);
    const digest = createHash('sha256');
    let next = 0;
    let total = 0;
    const worker = async () => {
      while (true) {
        const index = next++;
        if (index >= descriptors.length) return;
        const item = descriptors[index];
        const result = await rpc({ ...this, operation: 'getBlob', args: { hash: item.hash } });
        const encoded = String(result?.bytesBase64 || '');
        const piece = Buffer.from(encoded, 'base64');
        if (piece.toString('base64') !== encoded || piece.length !== item.bytes ||
            createHash('sha256').update(piece).digest('hex') !== item.sha256) {
          throw new Error('asset chunk integrity verification failed');
        }
        parts[index] = piece;
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, descriptors.length) }, worker));
    for (const piece of parts) {
      if (!piece) throw new Error('asset chunk assembly incomplete');
      digest.update(piece);
      total += piece.length;
    }
    if (total !== ref.value.bytes || digest.digest('hex') !== hash) {
      throw new Error('reconstructed peer asset failed integrity verification');
    }
    return Buffer.concat(parts, total);
  }
}