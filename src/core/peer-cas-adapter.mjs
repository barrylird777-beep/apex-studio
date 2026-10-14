import { createHash } from 'node:crypto';

/**
 * CAS adapter for SovereignMeshEngine.
 *
 * Immutable encrypted values are written through PeerContentAddressedStore.
 * Mutable references are changed only by authenticated peers implementing
 * atomic ref.get/ref.cas/ref.list operations. This adapter fails closed unless
 * every configured peer acknowledges the same reference version. It is not a
 * consensus protocol: production must configure a single authoritative
 * reference-coordination peer or a consensus-backed peer backend before use.
 */
const digest = value => createHash('sha256').update(String(value)).digest('hex');
const validPart = value => /^[A-Za-z0-9._:-]{1,180}$/.test(String(value || ''));

export function createPeerCasAdapter({ objectStore, transport, peers, namespace, replicaCount = 2 } = {}) {
  if (!objectStore || typeof objectStore.putObject !== 'function' || typeof objectStore.getObject !== 'function') {
    throw new TypeError('peer CAS adapter requires PeerContentAddressedStore');
  }
  if (!transport || typeof transport.request !== 'function') {
    throw new TypeError('peer CAS adapter requires authenticated peer transport');
  }
  const peerIds = [...new Set((peers || []).map(String).filter(Boolean))];
  if (!namespace || !peerIds.length || !Number.isSafeInteger(replicaCount) || replicaCount < 1 || peerIds.length < replicaCount) {
    throw new TypeError('valid namespace, peers, and replica policy are required');
  }

  async function request(peerId, operation, fields = {}) {
    const response = await transport.request(peerId, {
      protocol: 'apex.cas.v1', operation, namespace, ...fields
    });
    if (!response || response.accepted !== true || response.peerId !== peerId || response.namespace !== namespace) {
      throw new Error('peer CAS response identity, namespace, or acceptance verification failed');
    }
    return response;
  }

  async function readRef(bucket, key) {
    if (!validPart(bucket) || !validPart(key)) throw new TypeError('invalid CAS reference name');
    const failures = [];
    for (const peerId of peerIds) {
      try {
        const response = await request(peerId, 'ref.get', { bucket, key });
        if (response.exists === false) return null;
        if (!/^[a-f0-9]{64}$/.test(String(response.valueHash || '')) ||
            !/^[a-f0-9]{64}$/.test(String(response.refHash || ''))) {
          throw new Error('peer returned an invalid CAS reference');
        }
        const value = await objectStore.getObject(response.valueHash);
        return { value, hash: response.refHash };
      } catch (error) {
        if (error?.code === 'ENOENT' || error?.code === 'REF_NOT_FOUND') continue;
        failures.push({ peerId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    const error = new Error('CAS reference unavailable from configured peers');
    error.code = 'CAS_REF_UNAVAILABLE';
    error.failures = failures;
    throw error;
  }

  async function writeRef(bucket, key, value, { expectedHash = null } = {}) {
    if (!validPart(bucket) || !validPart(key)) throw new TypeError('invalid CAS reference name');
    if (expectedHash !== null && !/^[a-f0-9]{64}$/.test(String(expectedHash))) {
      throw new TypeError('expectedHash must be a SHA-256 version or null');
    }
    const object = await objectStore.putObject({ kind: 'apex.cas-ref-value.v1', namespace, value });
    const valueHash = object.hash;
    const refHash = digest(namespace + '\\0' + bucket + '\\0' + key + '\\0' + (expectedHash || 'null') + '\\0' + valueHash);
    const acknowledgements = [];
    const conflicts = [];
    const failures = [];
    for (const peerId of peerIds) {
      try {
        const response = await request(peerId, 'ref.cas', {
          bucket, key, expectedHash, valueHash, nextHash: refHash
        });
        if (response.applied === true && response.refHash === refHash && response.valueHash === valueHash) {
          acknowledgements.push(peerId);
        } else if (response.conflict === true) {
          conflicts.push({ peerId, currentHash: response.refHash || null });
        } else {
          throw new Error('peer did not confirm the requested atomic CAS transition');
        }
      } catch (error) {
        failures.push({ peerId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (conflicts.length) {
      const error = new Error('CAS reference changed concurrently');
      error.code = 'CAS_CONFLICT';
      error.conflicts = conflicts;
      error.acknowledgements = acknowledgements;
      throw error;
    }
    if (acknowledgements.length !== peerIds.length) {
      const error = new Error('reference CAS did not commit identically on every configured peer; outcome may be indeterminate');
      error.code = 'CAS_INDETERMINATE';
      error.acknowledgements = acknowledgements;
      error.failures = failures;
      throw error;
    }
    return { hash: refHash, valueHash, receipts: acknowledgements };
  }

  async function listRefs(bucket) {
    if (!validPart(bucket)) throw new TypeError('invalid CAS bucket name');
    const snapshots = [];
    const failures = [];
    for (const peerId of peerIds) {
      try {
        const response = await request(peerId, 'ref.list', { bucket });
        if (!Array.isArray(response.refs)) throw new Error('peer returned an invalid reference listing');
        snapshots.push({ peerId, refs: response.refs });
      } catch (error) {
        failures.push({ peerId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (snapshots.length !== peerIds.length) {
      const error = new Error('cannot list references consistently across every configured peer');
      error.code = 'CAS_LIST_INCOMPLETE';
      error.failures = failures;
      throw error;
    }
    const first = JSON.stringify(snapshots[0].refs.slice().sort((a,b) => String(a.key).localeCompare(String(b.key))));
    if (snapshots.some(item => JSON.stringify(item.refs.slice().sort((a,b) => String(a.key).localeCompare(String(b.key)))) !== first)) {
      const error = new Error('peer reference listings diverged; refusing to choose a winner');
      error.code = 'CAS_REPLICA_DIVERGENCE';
      throw error;
    }
    const refs = snapshots[0].refs;
    const output = [];
    for (const ref of refs) {
      if (!validPart(ref.key) || !/^[a-f0-9]{64}$/.test(String(ref.valueHash || '')) ||
          !/^[a-f0-9]{64}$/.test(String(ref.refHash || ''))) {
        throw new Error('peer returned malformed CAS reference metadata');
      }
      const wrapped = await objectStore.getObject(ref.valueHash);
      if (!wrapped || wrapped.kind !== 'apex.cas-ref-value.v1' || wrapped.namespace !== namespace) {
        throw new Error('CAS reference value failed namespace or type validation');
      }
      output.push({ key: ref.key, hash: ref.refHash, value: wrapped.value });
    }
    return output;
  }

  return Object.freeze({
    namespace,
    async init() {
      if (typeof objectStore.putObject !== 'function') throw new Error('peer object store is not ready');
      const probe = await readRef('meta', 'peer-cas-adapter-ready');
      if (probe === null) {
        // Do not write an initialization marker: initialization must be read-only.
      }
      return true;
    },
    readRef,
    writeRef,
    listRefs
  });
}
