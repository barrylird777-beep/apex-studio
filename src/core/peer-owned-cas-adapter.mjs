/**
 * Peer-owned CAS adapter for SovereignMeshEngine.
 *
 * All ref reads/writes execute on explicitly allowlisted authenticated peers.
 * No filesystem, WAL, JSON file, or hosted-object-store fallback exists here.
 * Every configured replica must confirm a ref write; partial writes fail closed.
 */
const validSegment = value => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(String(value || '')) &&
  !String(value).includes('..');

export function createPeerOwnedCASAdapter({
  transport,
  peers = [],
  namespace,
  replicaCount = 2,
  localPeerId = ''
} = {}) {
  if (!transport || typeof transport.request !== 'function') {
    throw new TypeError('authenticated peer transport is required');
  }
  if (!/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(String(namespace || ''))) {
    throw new TypeError('canonical app namespace is required');
  }
  const targets = [...new Set(peers.map(String).filter(Boolean))];
  if (!Number.isSafeInteger(replicaCount) || replicaCount < 1 || targets.length < replicaCount) {
    throw new Error('configured peer count cannot satisfy CAS replica policy');
  }
  if (localPeerId && targets.includes(String(localPeerId))) {
    throw new Error('writer peer must not be counted as a remote durability replica');
  }

  async function request(peerId, operation, fields = {}) {
    const response = await transport.request(peerId, {
      protocol: 'apex.cas.v1',
      operation,
      namespace,
      ...fields
    });
    if (!response || response.accepted !== true || response.peerId !== peerId ||
        response.namespace !== namespace || response.operation !== operation) {
      throw new Error('peer CAS response identity, namespace, or operation verification failed');
    }
    return response;
  }

  return Object.freeze({
    async init() {
      const checks = await Promise.allSettled(targets.map(peerId =>
        request(peerId, 'ref.health')));
      const healthy = checks.filter(item => item.status === 'fulfilled').length;
      if (healthy < replicaCount) {
        throw new Error('peer CAS initialization could not verify the required number of peer-owned ref backends');
      }
      return this;
    },

    async readRef(collection, key) {
      if (!validSegment(collection) || !validSegment(key)) throw new Error('invalid CAS ref key');
      const results = await Promise.allSettled(targets.map(peerId =>
        request(peerId, 'ref.get', { collection, key })));
      const values = results.filter(item => item.status === 'fulfilled')
        .map(item => item.value)
        .filter(item => item.found === true && item.ref && typeof item.ref.hash === 'string');
      if (values.length === 0) return null;
      const counts = new Map();
      for (const item of values) counts.set(item.ref.hash, (counts.get(item.ref.hash) || 0) + 1);
      const winner = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (!winner || winner[1] < replicaCount) {
        const error = new Error('peer CAS ref read has no matching replica quorum');
        error.code = 'CAS_READ_QUORUM_FAILED';
        throw error;
      }
      const selected = values.find(item => item.ref.hash === winner[0]);
      return { hash: selected.ref.hash, value: selected.ref.value };
    },

    async writeRef(collection, key, value, { expectedHash = null } = {}) {
      if (!validSegment(collection) || !validSegment(key)) throw new Error('invalid CAS ref key');
      if (expectedHash !== null && !/^[a-f0-9]{64}$/.test(String(expectedHash))) {
        throw new Error('expectedHash must be null or a SHA-256 ref hash');
      }
      const outcomes = await Promise.allSettled(targets.map(peerId =>
        request(peerId, 'ref.cas', { collection, key, value, expectedHash })));
      const successes = outcomes.filter(item => item.status === 'fulfilled').map(item => item.value);
      const conflicts = outcomes.filter(item => item.status === 'rejected' &&
        String(item.reason?.code || '') === 'CAS_CONFLICT');
      if (successes.length < replicaCount) {
        if (conflicts.length) {
          const error = new Error('peer CAS ref compare-and-swap conflict');
          error.code = 'CAS_CONFLICT';
          throw error;
        }
        const error = new Error('peer CAS ref write did not receive the required peer-owned durability quorum');
        error.code = 'CAS_WRITE_QUORUM_FAILED';
        error.confirmedReplicas = successes.length;
        error.requiredReplicas = replicaCount;
        throw error;
      }
      const hashes = new Set(successes.map(item => item.hash));
      if (hashes.size !== 1) {
        const error = new Error('peer CAS replicas committed divergent ref hashes');
        error.code = 'CAS_REPLICA_DIVERGENCE';
        throw error;
      }
      return { hash: successes[0].hash, receipts: successes.map(item => item.receipt) };
    },

    async listRefs(collection) {
      if (!validSegment(collection)) throw new Error('invalid CAS collection');
      const results = await Promise.allSettled(targets.map(peerId =>
        request(peerId, 'ref.list', { collection })));
      const successful = results.filter(item => item.status === 'fulfilled').map(item => item.value);
      if (successful.length < replicaCount) throw new Error('peer CAS ref listing did not reach the required replica quorum');
      const byKey = new Map();
      for (const result of successful) {
        if (!Array.isArray(result.refs)) throw new Error('peer CAS returned an invalid ref listing');
        for (const ref of result.refs) {
          if (!ref || !validSegment(ref.key) || typeof ref.hash !== 'string') {
            throw new Error('peer CAS returned a malformed ref entry');
          }
          const list = byKey.get(ref.key) || [];
          list.push(ref);
          byKey.set(ref.key, list);
        }
      }
      const output = [];
      for (const [key, entries] of byKey) {
        const counts = new Map();
        for (const entry of entries) counts.set(entry.hash, (counts.get(entry.hash) || 0) + 1);
        const winner = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
        if (!winner || winner[1] < replicaCount) {
          throw new Error('peer CAS ref listing contains a key without a matching replica quorum: ' + key);
        }
        const entry = entries.find(item => item.hash === winner[0]);
        output.push({ key, hash: entry.hash, value: entry.value });
      }
      return output;
    }
  });
}
