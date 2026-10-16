/**
 * Explicit canary adapter for non-critical KernelVision metadata.
 * It uses only the peer-backed CAS supplied by the caller; there is no local
 * fallback and it does not migrate, overwrite, or delete existing app records.
 */
export function createKernelVisionPeerStorageCanary({ store, enabled = false } = {}) {
  if (!enabled) return Object.freeze({
    enabled: false,
    async write() { throw new Error('KernelVision peer-storage canary is disabled'); },
    async read() { throw new Error('KernelVision peer-storage canary is disabled'); }
  });
  if (!store || store.namespace !== 'KernelVision' ||
      typeof store.writeRef !== 'function' || typeof store.readRef !== 'function') {
    throw new Error('KernelVision canary requires a peer-backed CAS scoped to the KernelVision namespace');
  }

  const keyFor = key => {
    if (typeof key !== 'string' || !/^[A-Za-z0-9._-]{1,120}$/.test(key)) {
      throw new TypeError('canary key must be 1-120 safe characters');
    }
    return 'canary-v1:' + key;
  };

  return Object.freeze({
    enabled: true,
    async write(key, value) {
      const refKey = keyFor(key);
      const current = await store.readRef(refKey);
      const result = await store.writeRef(refKey, {
        schema: 'apex.kernelvision.peer-canary.v1',
        key,
        value,
        writtenAt: new Date().toISOString()
      }, { expectedHash: current?.hash ?? null });
      return { key, hash: result.hash, replicas: result.replicas, receipts: result.receipts };
    },
    async read(key) {
      const result = await store.readRef(keyFor(key));
      if (!result) return null;
      if (result.value?.schema !== 'apex.kernelvision.peer-canary.v1' || result.value.key !== key) {
        throw new Error('canary reference failed schema/key verification');
      }
      return { key, value: result.value.value, hash: result.hash };
    }
  });
}
