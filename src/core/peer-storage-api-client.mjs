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
    return rpc({ socketPath: this.socketPath, token: this.token, app: this.app, operation: 'readRef', args: { namespace, key } });
  }

  async writeRef(namespace, key, value, options = {}) {
    if (Object.hasOwn(options, 'expectedHash')) {
      return rpc({ socketPath: this.socketPath, token: this.token, app: this.app, operation: 'writeRef', args: { namespace, key, value, expectedHash: options.expectedHash } });
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await this.readRef(namespace, key);
      try {
        return await rpc({ socketPath: this.socketPath, token: this.token, app: this.app, operation: 'writeRef',
          args: { namespace, key, value, expectedHash: current?.hash ?? null } });
      } catch (error) {
        if (error.code !== 'CAS_CONFLICT' || attempt === 7) throw error;
      }
    }
    throw new Error('peer API reference CAS retries exhausted');
  }

  listRefs(namespace) {
    return rpc({ socketPath: this.socketPath, token: this.token, app: this.app, operation: 'listRefs', args: { namespace } });
  }

  deleteRef(namespace, key, { expectedHash = null } = {}) {
    return rpc({ socketPath: this.socketPath, token: this.token, app: this.app, operation: 'deleteRef', args: { namespace, key, expectedHash } });
  }

  async putBlob(bytes) {
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    if (!buffer.length) throw new TypeError('cannot store an empty asset');
    const digest = createHash('sha256').update(buffer).digest('hex');
    const existing = await this.readRef('asset-manifests', digest);
    if (['apex.api.asset-manifest.v1', 'apex.api.asset-manifest.v2'].includes(existing?.value?.kind) &&
        existing.value.namespace === this.namespace && existing.value.sha256 === digest &&
        existing.value.bytes === buffer.length) {
      const recovered = await this.getBlob(digest);
      if (!recovered.equals(buffer)) throw new Error('existing peer asset failed deduplication integrity verification');
      return { hash: digest, bytes: buffer.length, contentSha256: digest, namespace: this.namespace, deduplicated: true };
    }
    const chunks = [];
    // The bridge accepts a 16 MiB JSON envelope; 8 MiB binary chunks fit after base64\n    // expansion and reduce manifest fan-out. The peer CAS subdivides each chunk internally.\n    const chunkSize = 8 * 1024 * 1024;
    for (let offset = 0; offset < buffer.length; offset += chunkSize) {
      const piece = buffer.subarray(offset, Math.min(offset + chunkSize, buffer.length));
      const stored = await rpc({ socketPath: this.socketPath, token: this.token, app: this.app, operation: 'putBlob', args: { bytesBase64: piece.toString('base64') } });
      if (!stored?.hash || !/^[a-f0-9]{64}$/.test(stored.hash)) throw new Error('peer did not return a valid chunk manifest hash');
      chunks.push({ hash: stored.hash, bytes: piece.length, sha256: createHash('sha256').update(piece).digest('hex') });
    }
    let manifest;
    if (chunks.length <= 64) {
      manifest = { version: 1, kind: 'apex.api.asset-manifest.v1', namespace: this.namespace,
        sha256: digest, bytes: buffer.length, chunks };
    } else {
      const fanout = 64;
      const writeNode = async node => {
        const hash = createHash('sha256').update(JSON.stringify(node)).digest('hex');
        try { await this.writeRef('asset-manifest-nodes', hash, node, { expectedHash: null }); }
        catch (error) {
          if (error.code !== 'CAS_CONFLICT') throw error;
          const prior = await this.readRef('asset-manifest-nodes', hash);
          if (!prior || JSON.stringify(prior.value) !== JSON.stringify(node) ||
              createHash('sha256').update(JSON.stringify(prior.value)).digest('hex') !== hash) throw error;
        }
        return { hash, level: node.level };
      };
      const writeLevel = async (entries, level, type) => {
        const nodes = [];
        for (let offset = 0; offset < entries.length; offset += fanout) {
          const group = entries.slice(offset, offset + fanout);
          const node = { version: 1, kind: 'apex.api.asset-manifest-node.v1', namespace: this.namespace,
            level, entries: group.map(item => type === 'chunk' ? { type: 'chunk', ...item } : { type: 'node', hash: item.hash }) };
          nodes.push(await writeNode(node));
        }
        return nodes;
      };
      let level = 0;
      let nodes = await writeLevel(chunks, level, 'chunk');
      while (nodes.length > 1) {
        level++;
        nodes = await writeLevel(nodes, level, 'node');
        if (level > 20) throw new Error('API asset manifest exceeds maximum supported tree depth');
      }
      manifest = { version: 2, kind: 'apex.api.asset-manifest.v2', namespace: this.namespace,
        sha256: digest, bytes: buffer.length, root: nodes[0].hash, rootLevel: nodes[0].level };
    }
    try {
      await this.writeRef('asset-manifests', digest, manifest, { expectedHash: existing?.hash ?? null });
    } catch (error) {
      if (error.code !== 'CAS_CONFLICT') throw error;
      const raced = await this.readRef('asset-manifests', digest);
      if (raced?.value?.sha256 !== digest || raced.value.bytes !== buffer.length ||
          raced.value.namespace !== this.namespace) throw error;
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
    let descriptors;
    if (ref.value.kind === 'apex.api.asset-manifest.v1' && ref.value.version === 1 && Array.isArray(ref.value.chunks)) {
      descriptors = ref.value.chunks;
    } else if (ref.value.kind === 'apex.api.asset-manifest.v2' && ref.value.version === 2 &&
        /^[a-f0-9]{64}$/.test(String(ref.value.root || '')) &&
        Number.isSafeInteger(ref.value.rootLevel) && ref.value.rootLevel >= 0 && ref.value.rootLevel <= 20) {
      const configured = Number(process.env.APEX_PEER_STORAGE_FETCH_CONCURRENCY || 8);
      const concurrency = Math.max(1, Math.min(32, Number.isSafeInteger(configured) ? configured : 8));
      let nodes = [ref.value.root];
      descriptors = [];
      for (let level = ref.value.rootLevel; level >= 0; level--) {
        const loaded = new Array(nodes.length);
        let nextNode = 0;
        const worker = async () => {
          while (true) {
            const index = nextNode++;
            if (index >= nodes.length) return;
            const nodeRef = await this.readRef('asset-manifest-nodes', nodes[index]);
            const node = nodeRef?.value;
            if (!node || node.kind !== 'apex.api.asset-manifest-node.v1' || node.version !== 1 ||
                node.namespace !== this.namespace || node.level !== level || !Array.isArray(node.entries) ||
                node.entries.length < 1 || node.entries.length > 64 ||
                createHash('sha256').update(JSON.stringify(node)).digest('hex') !== nodes[index]) {
              throw new Error('API asset manifest node failed CID, version, or namespace verification');
            }
            loaded[index] = node.entries;
          }
        };
        await Promise.all(Array.from({ length: Math.min(concurrency, nodes.length) }, worker));
        if (level === 0) {
          for (const entries of loaded) for (const item of entries) {
            if (item?.type !== 'chunk') throw new Error('API manifest leaf contains a non-chunk entry');
            descriptors.push({ hash: item.hash, bytes: item.bytes, sha256: item.sha256 });
          }
        } else {
          const next = [];
          for (const entries of loaded) for (const item of entries) {
            if (item?.type !== 'node' || !/^[a-f0-9]{64}$/.test(String(item.hash || ''))) {
              throw new Error('API manifest intermediate node reference is invalid');
            }
            next.push(item.hash);
          }
          nodes = next;
        }
      }
    } else {
      throw new Error('peer asset manifest version is unsupported or malformed');
    }
    if (!Array.isArray(descriptors) || descriptors.some(item => !item ||
        !/^[a-f0-9]{64}$/.test(String(item.hash || '')) ||
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
        const result = await rpc({ socketPath: this.socketPath, token: this.token, app: this.app, operation: 'getBlob', args: { hash: item.hash } });
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