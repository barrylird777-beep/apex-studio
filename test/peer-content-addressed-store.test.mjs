import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  PeerContentAddressedStore,
  createPeerObjectStorageHandler
} from '../src/core/peer-content-addressed-store.mjs';
import { createLibp2pPeerStorageTransport } from '../src/core/peer-storage-libp2p-transport.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function memoryStore() {
  const objects = new Map();
  return {
    objects,
    async putBytes(hash, input) {
      const bytes = Buffer.from(input);
      if (digest(bytes) !== hash) throw new Error('memory peer store hash mismatch');
      objects.set(hash, Buffer.from(bytes));
      return { hash, bytes: bytes.length };
    },
    async getBytes(hash) {
      if (!objects.has(hash)) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      return Buffer.from(objects.get(hash));
    }
  };
}

function makeMesh(ids = ['peer-a', 'peer-b']) {
  const stores = new Map();
  const handlers = new Map();
  for (const id of ids) {
    const store = memoryStore();
    const refs = new Map();
    store.readRef = async (namespace, key) => refs.get(namespace + ':' + key) ?? null;
    store.writeRef = async (namespace, key, expectedHash, hash, bytes) => {
      const refKey = namespace + ':' + key;
      if ((refs.get(refKey)?.hash ?? null) !== expectedHash) throw new Error('reference compare-and-swap conflict');
      refs.set(refKey, { hash, bytes: Buffer.from(bytes) });
      return { hash };
    };
    const transactions = new Map();
    store.prepareRef = async ({ transactionId, namespace, key, expectedHash, hash, bytes, participants }) => {
      const prior = transactions.get(transactionId);
      if (prior) return { transactionId, state: prior.state, hash: prior.hash };
      const current = refs.get(namespace + ':' + key);
      if ((current?.hash ?? null) !== expectedHash) throw Object.assign(new Error('reference prepare conflict'), { code: 'REFERENCE_CONFLICT' });
      for (const tx of transactions.values()) {
        if (tx.namespace === namespace && tx.key === key && ['prepared', 'commit-decided'].includes(tx.state)) {
          throw Object.assign(new Error('unresolved transaction'), { code: 'REFERENCE_TRANSACTION_BLOCKED' });
        }
      }
      await store.putBytes(hash, bytes);
      transactions.set(transactionId, { transactionId, namespace, key, expectedHash, hash, bytes: Buffer.from(bytes), participants: [...participants].sort(), state: 'prepared' });
      return { transactionId, state: 'prepared', hash };
    };
    store.decideRefCommit = async (transactionId, participants) => {
      const tx = transactions.get(transactionId);
      if (!tx || digest(Buffer.from(JSON.stringify([...participants].sort()))) !== digest(Buffer.from(JSON.stringify(tx.participants)))) throw new Error('missing transaction or participant mismatch');
      if (tx.state === 'prepared') tx.state = 'commit-decided';
      if (!['commit-decided', 'committed'].includes(tx.state)) throw new Error('transaction not committable');
      return { transactionId, state: tx.state, hash: tx.hash };
    };
    store.commitPreparedRef = async transactionId => {
      const tx = transactions.get(transactionId);
      if (!tx || !['commit-decided', 'committed'].includes(tx.state)) throw new Error('no durable decision');
      const current = refs.get(tx.namespace + ':' + tx.key);
      if ((current?.hash ?? null) === tx.expectedHash) refs.set(tx.namespace + ':' + tx.key, { hash: tx.hash, bytes: Buffer.from(tx.bytes) });
      else if (current?.hash !== tx.hash) throw Object.assign(new Error('reference divergence'), { code: 'REFERENCE_DIVERGENCE' });
      tx.state = 'committed';
      return { transactionId, state: tx.state, hash: tx.hash };
    };
    store.abortPreparedRef = async transactionId => {
      const tx = transactions.get(transactionId);
      if (!tx) return { transactionId, state: 'absent' };
      if (tx.state === 'prepared') tx.state = 'aborted';
      else if (tx.state !== 'aborted') throw new Error('cannot abort committed decision');
      return { transactionId, state: tx.state };
    };
    store.getRefTransaction = async transactionId => {
      const tx = transactions.get(transactionId);
      if (!tx) return null;
      const { transactionId: id, namespace, key, expectedHash, hash, participants, state } = tx;
      return { transactionId: id, namespace, key, expectedHash, hash, participants, state };
    };
    store.listRefTransactions = async namespace => [...transactions.values()]
      .filter(tx => tx.namespace === namespace && ['prepared', 'commit-decided'].includes(tx.state))
      .map(tx => ({ transactionId: tx.transactionId, namespace: tx.namespace, key: tx.key, state: tx.state }));
    store.health = async ({ namespace, peerId }) => ({
      durable: true, ownership: 'peer-owned', restartRecoveryVerified: true,
      atomicReferencesVerified: true, peerId, namespace,
      receipt: 'test-receipt-' + id + '-' + namespace,
      receiptId: 'test-proof-' + id + '-' + namespace
    });
    store.verifyDurabilityReceipt = async (receipt, claims) =>
      receipt === 'test-receipt-' + id + '-' + claims.namespace &&
      claims.peerId === id && claims.namespace === 'PlanetApeX' &&
      claims.restartRecoveryVerified === true && claims.atomicReferencesVerified === true;
    stores.set(id, store);
    handlers.set(id, createPeerObjectStorageHandler({ store, peerId: id, maxObjectBytes: 1024 * 1024, authorizeNamespace: ({ remotePeerId, namespace }) => remotePeerId === 'writer-peer' && namespace === 'PlanetApeX' }));
  }
  const unavailable = new Set();
  const transport = {
    async request(peerId, envelope) {
      if (unavailable.has(peerId)) throw new Error('peer unavailable');
      const handler = handlers.get(peerId);
      if (!handler) throw new Error('unknown peer');
      return handler(envelope, { remotePeerId: 'writer-peer' });
    }
  };
  return {
    stores,
    handlers,
    unavailable,
    client: new PeerContentAddressedStore({ transport, peers: ids, replicaCount: Math.min(2, ids.length), failureDomainsByPeerId: Object.fromEntries(ids.map(id => [id, 'test-domain-' + id])), namespace: 'PlanetApeX', encryptionKey: Buffer.alloc(32, 7) })
  };
}

test('peer CAS refuses to count an object write from a volatile peer as durable', async () => {
  const store = memoryStore();
  const handler = createPeerObjectStorageHandler({
    store, peerId: 'volatile-peer',
    authorizeNamespace: ({ remotePeerId, namespace }) => remotePeerId === 'writer-peer' && namespace === 'PlanetApeX'
  });
  const client = new PeerContentAddressedStore({
    transport: { request: async (_peerId, envelope) => handler(envelope, { remotePeerId: 'writer-peer' }) },
    peers: ['volatile-peer'], replicaCount: 1, namespace: 'PlanetApeX',
    encryptionKey: Buffer.alloc(32, 7)
  });
  await assert.rejects(client.putObject({ mustNotBeCalledDurable: true }), error =>
    error.code === 'INSUFFICIENT_REPLICAS' &&
    error.failures.some(failure => /unverified durability receipt/.test(failure.error))
  );
});

test('peer CAS stores identical immutable bytes on independent peers and verifies receipts', async () => {
  const mesh = makeMesh();
  const value = { app: 'PlanetApeX', object: 'manuscript', version: 1 };
  const result = await mesh.client.putObject(value);
  assert.equal(result.replicas.length, 2);
  assert.deepEqual(result.replicas.sort(), ['peer-a', 'peer-b']);
  assert.equal(result.receipts.every(receipt => receipt.hash === result.hash), true);
  assert.deepEqual(await mesh.client.getObject(result.hash), value);
  assert.equal(mesh.stores.get('peer-a').objects.has(result.hash), true);
  assert.equal(mesh.stores.get('peer-b').objects.has(result.hash), true);
  assert.equal(mesh.stores.get('peer-a').objects.get(result.hash).includes(Buffer.from('manuscript')), false);
});

test('peer CAS atomically replicates mutable references and recovers them from a surviving peer', async () => {
  const mesh = makeMesh();
  const manifest = { version: 1, app: 'PlanetApeX', projectId: 'project-1', assets: [{ id: 'cover', hash: 'a'.repeat(64) }] };
  const saved = await mesh.client.writeRef('project-project-1', manifest);
  assert.equal(saved.replicas.length, 2);
  const restored = await mesh.client.readRef('project-project-1');
  assert.deepEqual(restored.value, manifest);
  assert.equal(restored.hash, saved.hash);
  mesh.unavailable.add('peer-a');
  assert.deepEqual((await mesh.client.readRef('project-project-1')).value, manifest);
});

test('peer CAS refuses to choose between divergent mutable references', async () => {
  const mesh = makeMesh();
  await mesh.client.writeRef('project-project-2', { version: 1, app: 'PlanetApeX', assets: [] });
  const store = mesh.stores.get('peer-b');
  const conflicting = Buffer.from((await import('../src/core/apex-cbor.mjs')).encodeCanonical({ version: 1, app: 'PlanetApeX', assets: [{ id: 'unexpected' }] }));
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256').update(conflicting).digest('hex');
  await store.writeRef('PlanetApeX', 'project-project-2', (await mesh.client.readRef('project-project-2')).hash, hash, conflicting).catch(() => {});
  await assert.rejects(mesh.client.readRef('project-project-2'), error => error.code === 'REFERENCE_DIVERGENCE');
});

test('peer CAS fails closed when the configured replica count cannot be met', async () => {
  const mesh = makeMesh();
  mesh.unavailable.add('peer-b');
  await assert.rejects(
    mesh.client.putObject({ preserve: true }),
    error => error.code === 'INSUFFICIENT_REPLICAS' && error.requiredReplicas === 2 && error.verifiedReplicas === 1
  );
});

test('peer CAS retrieves from a surviving replica when another peer is unavailable', async () => {
  const mesh = makeMesh();
  const value = { durable: true, count: 7 };
  const result = await mesh.client.putObject(value);
  mesh.unavailable.add('peer-a');
  assert.deepEqual(await mesh.client.getObject(result.hash), value);
});

test('peer object handler rejects unauthenticated requests and corrupted content', async () => {
  const store = memoryStore();
  const handler = createPeerObjectStorageHandler({ store, peerId: 'peer-a', authorizeNamespace: ({ remotePeerId, namespace }) => remotePeerId === 'writer-peer' && namespace === 'PlanetApeX' });
  await assert.rejects(
    handler({ protocol: 'apex.cas.v1', operation: 'object.get', namespace: 'PlanetApeX', hash: 'a'.repeat(64) }, {}),
    /authenticated remote peer identity missing/
  );
  const bytes = Buffer.from('{"tampered":true}', 'utf8');
  await assert.rejects(
    handler({ protocol: 'apex.cas.v1', operation: 'object.put', namespace: 'PlanetApeX', hash: '0'.repeat(64), bytesBase64: bytes.toString('base64') }, { remotePeerId: 'writer-peer' }),
    /hash mismatch/
  );
});

test('peer CAS refuses fewer configured peers than the durability policy requires', async () => {
  assert.throws(
    () => new PeerContentAddressedStore({ transport: { request: async () => ({}) }, peers: ['peer-a'], replicaCount: 2, namespace: 'PlanetApeX', encryptionKey: Buffer.alloc(32, 7) }),
    /insufficient configured peers/
  );
});

test('peer storage denies cross-app namespace access', async () => {
  const store = memoryStore();
  const handler = createPeerObjectStorageHandler({
    store,
    peerId: 'peer-a',
    authorizeNamespace: ({ remotePeerId, namespace }) => remotePeerId === 'writer-peer' && namespace === 'PlanetApeX'
  });
  await assert.rejects(
    handler({ protocol: 'apex.cas.v1', operation: 'object.get', namespace: 'KashKorner', hash: 'a'.repeat(64) }, { remotePeerId: 'writer-peer' }),
    /namespace access denied/
  );
});

test('peer CAS authenticates the app namespace as AES-GCM additional data', () => {
  const mesh = makeMesh();
  const envelope = mesh.client.encrypt({ private: 'app-bound' });
  const otherNamespace = new PeerContentAddressedStore({
    transport: mesh.client.transport,
    peers: ['peer-a', 'peer-b'],
    replicaCount: 2,
    failureDomainsByPeerId: { 'peer-a': 'test-domain-peer-a', 'peer-b': 'test-domain-peer-b' },
    namespace: 'KernelVision',
    encryptionKey: Buffer.alloc(32, 7)
  });
  assert.throws(
    () => otherNamespace.decrypt({ ...envelope, namespace: 'KernelVision' }),
    /authenticate|decrypt|Unsupported state|unable to authenticate/i
  );
});

test('peer CAS cannot decrypt an object under a different app namespace', async () => {
  const mesh = makeMesh();
  const result = await mesh.client.putObject({ secret: 'private' });
  const otherNamespace = new PeerContentAddressedStore({
    transport: mesh.client.transport,
    peers: ['peer-a', 'peer-b'],
    replicaCount: 2,
    failureDomainsByPeerId: { 'peer-a': 'test-domain-peer-a', 'peer-b': 'test-domain-peer-b' },
    namespace: 'KernelVision',
    encryptionKey: Buffer.alloc(32, 7)
  });
  await assert.rejects(otherNamespace.getObject(result.hash), error => error.code === 'OBJECT_UNAVAILABLE');
});

test('libp2p transport binds each configured address to the exact peer identity', async () => {
  const calls = [];
  const transport = createLibp2pPeerStorageTransport({
    node: { dialProtocol() {} },
    addressesByPeerId: { 'peer-a': '/ip4/127.0.0.1/tcp/9000/p2p/peer-a' },
    send: async (_node, address, envelope) => {
      calls.push({ address, envelope });
      return { accepted: true, peerId: 'peer-a', hash: envelope.hash };
    }
  });
  const response = await transport.request('peer-a', { protocol: 'apex.cas.v1', operation: 'object.get', hash: 'a'.repeat(64) });
  assert.equal(response.peerId, 'peer-a');
  assert.equal(calls.length, 1);
  await assert.rejects(transport.request('peer-b', { protocol: 'apex.cas.v1' }), /not explicitly configured/);
});

test('libp2p transport rejects a configured multiaddress with a mismatched peer ID', () => {
  assert.throws(
    () => createLibp2pPeerStorageTransport({
      node: { dialProtocol() {} },
      addressesByPeerId: { 'peer-a': '/ip4/127.0.0.1/tcp/9000/p2p/peer-b' }
    }),
    /exact configured peer ID/
  );
});

test('libp2p transport rejects an ACK that names a different peer', async () => {
  const transport = createLibp2pPeerStorageTransport({
    node: { dialProtocol() {} },
    addressesByPeerId: { 'peer-a': '/ip4/127.0.0.1/tcp/9000/p2p/peer-a' },
    send: async () => ({ accepted: true, peerId: 'peer-imposter' })
  });
  await assert.rejects(
    transport.request('peer-a', { protocol: 'apex.cas.v1' }),
    /unexpected authenticated identity/
  );
});


test('peer CAS requires explicit independent failure domains when configured', async () => {
  const mesh = makeMesh();
  assert.throws(
    () => new PeerContentAddressedStore({
      transport: mesh.client.transport,
      peers: ['peer-a', 'peer-b'],
      replicaCount: 2,
      minFailureDomains: 2,
      namespace: 'PlanetApeX',
      encryptionKey: Buffer.alloc(32, 7)
    }),
    /explicit failure domain/
  );
  assert.throws(
    () => new PeerContentAddressedStore({
      transport: mesh.client.transport,
      peers: ['peer-a', 'peer-b'],
      replicaCount: 2,
      minFailureDomains: 2,
      namespace: 'PlanetApeX',
      encryptionKey: Buffer.alloc(32, 7)
    }),
    /explicit failure domain/
  );
  assert.throws(
    () => new PeerContentAddressedStore({
      transport: mesh.client.transport,
      peers: ['peer-a', 'peer-b'],
      replicaCount: 2,
      minFailureDomains: 2,
      failureDomainsByPeerId: { 'peer-a': 'region-1', 'peer-b': 'region-1' },
      namespace: 'PlanetApeX',
      encryptionKey: Buffer.alloc(32, 7)
    }),
    /insufficient configured failure domains/
  );
});

test('peer CAS verifies replica count and distinct failure domains before reporting durable success', async () => {
  const mesh = makeMesh();
  const client = new PeerContentAddressedStore({
    transport: mesh.client.transport,
    peers: ['peer-a', 'peer-b'],
    replicaCount: 2,
    minFailureDomains: 2,
    failureDomainsByPeerId: { 'peer-a': 'region-1', 'peer-b': 'region-2' },
    namespace: 'PlanetApeX',
    encryptionKey: Buffer.alloc(32, 7)
  });
  const result = await client.putObject({ critical: 'must survive a domain loss' });
  assert.equal(result.replicas.length, 2);
  assert.equal(new Set(result.receipts.map(receipt => receipt.failureDomain)).size, 2);
  assert.deepEqual(await client.getObject(result.hash), { critical: 'must survive a domain loss' });
});


test('peer CAS rejects objects that exceed the safe single-envelope limit until chunking exists', async () => {
  const mesh = makeMesh();
  await assert.rejects(
    mesh.client.putObject({ large: 'x'.repeat(40 * 1024) }),
    error => error.code === 'OBJECT_TOO_LARGE_REQUIRES_CHUNKING' && error.maxObjectBytes === 32 * 1024
  );
});


test('peer CAS stores and reconstructs large binary blobs through encrypted chunks and verified manifests', async () => {
  const mesh = makeMesh();
  const client = mesh.client;
  const source = Buffer.alloc(128 * 1024);
  for (let i = 0; i < source.length; i++) source[i] = (i * 31 + 17) % 256;
  const receipt = await client.putBlob(source, { chunkSize: 8 * 1024 });
  assert.equal(receipt.kind, 'apex.blob-manifest.v1');
  assert.equal(receipt.totalBytes, source.length);
  assert.equal(receipt.chunkCount, 16);
  const recovered = await client.getBlob(receipt.hash);
  assert.deepEqual(recovered, source);
});

test('peer CAS detects a missing blob chunk instead of returning partial content', async () => {
  const mesh = makeMesh();
  const source = Buffer.alloc(24 * 1024, 91);
  const receipt = await mesh.client.putBlob(source, { chunkSize: 8 * 1024 });
  const manifest = await mesh.client.getObject(receipt.hash);
  const missingHash = manifest.chunks[1].hash;
  mesh.stores.get('peer-a').objects.delete(missingHash);
  mesh.stores.get('peer-b').objects.delete(missingHash);
  await assert.rejects(mesh.client.getBlob(receipt.hash), error => error.code === 'OBJECT_UNAVAILABLE');
});


test('peer CAS repairs a missing replica without changing the immutable object hash', async () => {
  const mesh = makeMesh();
  const value = { repairable: true, app: 'PlanetApeX' };
  const receipt = await mesh.client.putObject(value);
  mesh.stores.get('peer-b').objects.delete(receipt.hash);
  const repaired = await mesh.client.repairObject(receipt.hash, ['peer-b']);
  assert.equal(repaired.sourcePeerId, 'peer-a');
  assert.equal(repaired.repaired[0].peerId, 'peer-b');
  assert.equal(repaired.hash, receipt.hash);
  assert.deepEqual(await mesh.client.getObject(receipt.hash), value);
});

test('peer CAS repair fails closed when no authorized source replica survives', async () => {
  const mesh = makeMesh();
  const receipt = await mesh.client.putObject({ shouldNotDisappear: true });
  mesh.stores.get('peer-a').objects.delete(receipt.hash);
  mesh.stores.get('peer-b').objects.delete(receipt.hash);
  await assert.rejects(
    mesh.client.repairObject(receipt.hash, ['peer-a']),
    error => error.code === 'OBJECT_UNAVAILABLE'
  );
});


test('single-replica durability policy does not require failure-domain labels', async () => {
  const mesh = makeMesh();
  const client = new PeerContentAddressedStore({
    transport: mesh.client.transport,
    peers: ['peer-a'],
    replicaCount: 1,
    minFailureDomains: 1,
    namespace: 'PlanetApeX',
    encryptionKey: Buffer.alloc(32, 7)
  });
  const receipt = await client.putObject({ noDomainMapNeeded: true });
  assert.equal(receipt.replicas.length, 1);
  assert.deepEqual(await client.getObject(receipt.hash), { noDomainMapNeeded: true });
});

test('peer CAS refuses to advertise distributed atomicity when a backend lacks transaction recovery primitives', async () => {
  const objects = new Map();
  const refs = new Map();
  const durableStore = {
    durable: true,
    ownership: 'peer-owned',
    async health({ namespace, peerId }) {
      return { durable: true, ownership: 'peer-owned', restartRecoveryVerified: true, atomicReferencesVerified: true, peerId, namespace, receipt: 'signed-test-receipt', receiptId: 'test-proof-1' };
    },
    async verifyDurabilityReceipt(receipt, claims) {
      return receipt === 'signed-test-receipt' && claims.peerId === 'capacity-peer' &&
        claims.namespace === 'PlanetApeX' && claims.restartRecoveryVerified === true &&
        claims.atomicReferencesVerified === true;
    },
    async putBytes(hash, input) {
      const bytes = Buffer.from(input);
      assert.equal(digest(bytes), hash);
      objects.set(hash, bytes);
      return { hash, bytes: bytes.length };
    },
    async getBytes(hash) {
      if (!objects.has(hash)) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      return Buffer.from(objects.get(hash));
    },
    async readRef(namespace, key) {
      const value = refs.get(namespace + ':' + key);
      return value ? { hash: value.hash, bytes: Buffer.from(value.bytes) } : null;
    },
    async writeRef(namespace, key, expectedHash, hash, input) {
      const refKey = namespace + ':' + key;
      const current = refs.get(refKey);
      if ((current?.hash ?? null) !== expectedHash) throw new Error('reference compare-and-swap conflict');
      const bytes = Buffer.from(input);
      assert.equal(digest(bytes), hash);
      refs.set(refKey, { hash, bytes });
      return { hash };
    }
  };
  const handler = createPeerObjectStorageHandler({
    store: durableStore,
    peerId: 'capacity-peer',
    authorizeNamespace: ({ remotePeerId, namespace }) => remotePeerId === 'writer-peer' && namespace === 'PlanetApeX'
  });
  const context = { remotePeerId: 'writer-peer' };
  const health = await handler({ protocol: 'apex.cas.v1', operation: 'storage.health', namespace: 'PlanetApeX' }, context);
  assert.equal(health.durable, false);
  assert.equal(health.ownership, 'unverified');
  assert.equal(health.recoveryVerified, false);
  assert.equal(health.restartRecoveryVerified, false);
  assert.equal(health.atomicReferencesVerified, false);
  assert.equal(health.receiptId, undefined);

  await assert.rejects(
    handler({ protocol: 'apex.cas.v1', operation: 'ref.cas', namespace: 'PlanetApeX', key: 'root', expectedHash: null, hash: 'a'.repeat(64), bytesBase64: Buffer.from('legacy').toString('base64') }, context),
    /unsupported peer storage operation/
  );
  await assert.rejects(
    handler({ protocol: 'apex.cas.v1', operation: 'ref.get', namespace: 'PlanetApeX', key: 'root' }, context),
    /verified durable peer-owned storage/
  );
  await assert.rejects(
    handler({ protocol: 'apex.cas.v1', operation: 'ref.get', namespace: 'KashKorner', key: 'root' }, context),
    /namespace access denied/
  );
});

test('peer CAS never advertises durability for a volatile backend', async () => {
  const handler = createPeerObjectStorageHandler({
    store: memoryStore(),
    peerId: 'volatile-peer',
    authorizeNamespace: ({ remotePeerId, namespace }) => remotePeerId === 'writer-peer' && namespace === 'PlanetApeX'
  });
  const health = await handler({ protocol: 'apex.cas.v1', operation: 'storage.health', namespace: 'PlanetApeX' }, { remotePeerId: 'writer-peer' });
  assert.equal(health.durable, false);
  assert.equal(health.ownership, 'unverified');
  assert.equal(health.recoveryVerified, false);
  await assert.rejects(
    handler({ protocol: 'apex.cas.v1', operation: 'ref.get', namespace: 'PlanetApeX', key: 'root' }, { remotePeerId: 'writer-peer' }),
    /verified durable peer-owned storage/
  );
});


test('peer CAS rejects unverified durability claims even when backend self-labels as durable', async () => {
  const store = {
    ...memoryStore(),
    durable: true,
    ownership: 'peer-owned',
    async health({ namespace, peerId }) {
      return { durable: true, ownership: 'peer-owned', restartRecoveryVerified: true, atomicReferencesVerified: true, namespace, peerId, receipt: 'forged', receiptId: 'untrusted' };
    },
    async readRef() { return null; },
    async writeRef() { throw new Error('must not reach unverified reference backend'); }
  };
  const handler = createPeerObjectStorageHandler({
    store,
    peerId: 'capacity-peer',
    authorizeNamespace: ({ remotePeerId, namespace }) => remotePeerId === 'writer-peer' && namespace === 'PlanetApeX'
  });
  const health = await handler({ protocol: 'apex.cas.v1', operation: 'storage.health', namespace: 'PlanetApeX' }, { remotePeerId: 'writer-peer' });
  assert.equal(health.durable, false);
  assert.equal(health.ownership, 'unverified');
  await assert.rejects(
    handler({ protocol: 'apex.cas.v1', operation: 'ref.get', namespace: 'PlanetApeX', key: 'root' }, { remotePeerId: 'writer-peer' }),
    /verified durable peer-owned storage/
  );
});


test('peer CAS aborts a prepared write when a participant is unavailable before decision', async () => {
  const mesh = makeMesh();
  mesh.unavailable.add('peer-b');
  let transactionId;
  await assert.rejects(
    mesh.client.writeRef('partial-commit-case', { version: 1, payload: 'must-not-be-blindly-retried' }),
    error => {
      transactionId = error.transactionId;
      return error.code === 'PREPARE_INCOMPLETE' && Boolean(transactionId) &&
        error.preparedPeers.includes('peer-a');
    }
  );
  mesh.unavailable.delete('peer-b');
  assert.equal(await mesh.client.readRef('partial-commit-case'), null);
  await assert.rejects(
    mesh.client.recoverRefTransaction(transactionId),
    error => error.code === 'RECOVERY_BLOCKED'
  );
  assert.equal((await mesh.client.recoverRefTransaction(transactionId, { coordinatorStopped: true })).state, 'aborted');
});

test('peer CAS concurrent writers using one expected head cannot both commit', async () => {
  const mesh = makeMesh();
  const outcomes = await Promise.allSettled([
    mesh.client.writeRef('concurrent-ref', { writer: 'a' }, { expectedHash: null }),
    mesh.client.writeRef('concurrent-ref', { writer: 'b' }, { expectedHash: null })
  ]);
  const successes = outcomes.filter(item => item.status === 'fulfilled');
  assert.ok(successes.length <= 1, 'at most one writer may commit from the same expected head');
  const winner = await mesh.client.readRef('concurrent-ref');
  if (successes.length === 1) assert.ok(['a', 'b'].includes(winner.value.writer));
  else assert.equal(winner, null);
});

test('peer CAS recovers a durable commit decision after a peer commit failure', async () => {
  const mesh = makeMesh();
  const baseTransport = mesh.client.transport;
  let failCommit = true;
  mesh.client.transport = {
    async request(peerId, request) {
      if (request.operation === 'ref.commit' && peerId === 'peer-b' && failCommit) {
        failCommit = false;
        throw new Error('simulated crash after durable commit decision');
      }
      return baseTransport.request(peerId, request);
    }
  };
  let transactionId;
  await assert.rejects(
    mesh.client.writeRef('recoverable-ref', { revision: 1 }, { expectedHash: null }),
    error => {
      transactionId = error.transactionId;
      return error.code === 'COMMIT_OUTCOME_UNKNOWN' && Boolean(transactionId);
    }
  );
  mesh.client.transport = baseTransport;
  await assert.rejects(
    mesh.client.readRef('recoverable-ref'),
    error => error.code === 'REFERENCE_READ_INCOMPLETE'
  );
  const recovery = await mesh.client.recoverPendingRefTransactions();
  assert.equal(recovery.recovered, 1);
  assert.equal(recovery.outcomes[0].transactionId, transactionId);
  assert.equal(recovery.outcomes[0].state, 'committed');
  assert.equal((await mesh.client.readRef('recoverable-ref')).value.revision, 1);
});
