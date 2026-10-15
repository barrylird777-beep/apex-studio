import { randomUUID } from 'node:crypto';
import { createPeerStorageApiBridge, APEX_APPS } from '../../src/core/peer-storage-api-bridge.mjs';

export async function startTestPeerBridge(socketPath) {
  const tokens = Object.fromEntries(APEX_APPS.map(app => [app, 'test-token-' + app + '-' + randomUUID().repeat(2)]));
  const stores = Object.create(null);
  for (const app of APEX_APPS) {
    const refs = new Map();
    const blobs = new Map();
    const cas = {
      namespace: app,
      async readRef(namespace, key) {
        const ref = refs.get(namespace + '/' + key);
        return ref ? structuredClone(ref) : null;
      },
      async writeRef(namespace, key, value, { expectedHash = null } = {}) {
        const id = namespace + '/' + key;
        const current = refs.get(id);
        if ((current?.hash ?? null) !== expectedHash) {
          const error = new Error('peer CAS conflict');
          error.code = 'CAS_CONFLICT';
          throw error;
        }
        const hash = randomUUID().replaceAll('-', '').padEnd(64, '0');
        refs.set(id, { namespace: app, key: namespace + '/' + key, value: structuredClone(value), hash });
        return { hash };
      },
      async listRefs(namespace) {
        return [...refs.values()].filter(ref => ref.key.startsWith(namespace + '/')).map(ref => ({ ...structuredClone(ref), namespace, key: ref.key.slice(namespace.length + 1) }));
      },
      async deleteRef(namespace, key, { expectedHash = null } = {}) {
        const id = namespace + '/' + key;
        const current = refs.get(id);
        if (!current) return false;
        if (expectedHash != null && current.hash !== expectedHash) {
          const error = new Error('peer CAS conflict');
          error.code = 'CAS_CONFLICT';
          throw error;
        }
        refs.delete(id);
        return true;
      }
    };
    const objects = {
      namespace: app,
      async putBlob(bytes) {
        const hash = randomUUID().replaceAll('-', '').padEnd(64, '0');
        blobs.set(hash, Buffer.from(bytes));
        return { hash, bytes: bytes.length };
      },
      async getBlob(hash) {
        const bytes = blobs.get(hash);
        if (!bytes) throw new Error('test peer blob missing');
        return Buffer.from(bytes);
      }
    };
    stores[app] = { cas, objects };
  }
  const bridge = createPeerStorageApiBridge({ stores, tokens, socketPath });
  await bridge.listen();
  return { bridge, tokens, close: () => bridge.close() };
}
