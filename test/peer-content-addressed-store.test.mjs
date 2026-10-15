import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign as signBytes, verify as verifyBytes } from 'node:crypto';
import { encodeCanonical, decodeCanonical } from '../src/core/apex-cbor.mjs';
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
  const keyPairs = Object.fromEntries(ids.map(id => [id, generateKeyPairSync('ed25519')]));
  const receiptPublicKeysByPeerId = Object.fromEntries(ids.map(id => [id, keyPairs[id].publicKey.export({ format: 'der', type: 'spki' }).toString('base64')]));
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
    store.health = async ({ namespace, peerId, operation = 'storage.health', objectHash = null, key = null }) => {
      const claims = { version: 1, peerId, namespace, operation, objectHash, key,
        ownership: 'peer-owned', durable: true, atomicReferencesVerified: true,
        restartRecoveryVerified: true };
      const body = encodeCanonical(claims);
      return { ...claims, receipt: { algorithm: 'Ed25519', body: body.toString('base64'),
        signature: signBytes(null, body, keyPairs[id].privateKey).toString('base64') },
        receiptId: digest(body) };
    };
    store.verifyDurabilityReceipt = async (receipt, claims) => {
      try {
        const body = Buffer.from(receipt.body, 'base64');
        const signed = decodeCanonical(body);
        return receipt.algorithm === 'Ed25519' && body.toString('base64') === receipt.body &&
          verifyBytes(null, body, keyPairs[id].publicKey, Buffer.from(receipt.signature, 'base64')) &&
          claims.peerId === id && claims.namespace === 'PlanetApeX' &&
          claims.restartRecoveryVerified === true && claims.atomicReferencesVerified === true &&
          signed.peerId === id && signed.namespace === claims.namespace;
      } catch { return false; }
    };
    stores.set(id, store);
    handlers.set(id, createPeerObjectStorageHandler({ store, peerId: id, maxObjectBytes: 1024 * 1024, authorizeNamespace: ({ remotePeerId, namespace }) => remotePeerId === 'writer-peer' && namespace === 'PlanetApeX' }));
  }
  const unavailable = new Set();
  const stalled = new Set();
  const transport = {
    async request(peerId, envelope, { signal } = {}) {
      if (stalled.has(peerId)) return new Promise((resolve, reject) => {
        const cancel = () => reject(signal?.reason || new Error('peer request cancelled'));
        if (signal?.aborted) cancel();
        else signal?.addEventListener('abort', cancel, { once: true });
      });
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
    stalled,
    transport,
    client: new PeerContentAddressedStore({ transport, peers: ids, replicaCount: Math.min(2, ids.length), failureDomainsByPeerId: Object.fromEntries(ids.map(id => [id, 'test-domain-' + id])), namespace: 'PlanetApeX', encryptionKey: Buffer.alloc(32, 7), receiptPublicKeysByPeerId })
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
  await assert.rejects(mesh.client.readRef('project-project-1'), error =>
    error.code === 'INSUFFICIENT_REPLICAS' && error.verifiedReplicas === 1
  );
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
    encryptionKey: Buffer.alloc(32, 7), receiptPublicKeysByPeerId: mesh.client.receiptPublicKeysByPeerId
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
    encryptionKey: Buffer.alloc(32, 7), receiptPublicKeysByPeerId: mesh.client.receiptPublicKeysByPeerId
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
    encryptionKey: Buffer.alloc(32, 7), receiptPublicKeysByPeerId: mesh.client.receiptPublicKeysByPeerId
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
    encryptionKey: Buffer.alloc(32, 7), receiptPublicKeysByPeerId: mesh.client.receiptPublicKeysByPeerId
  });
  const receipt = await client.putObject({ noDomainMapNeeded: true });
  assert.equal(receipt.replicas.length, 1);
  assert.deepEqual(await client.getObject(receipt.hash), { noDomainMapNeeded: true });
});

test('peer CAS protocol exposes durable health and atomic namespaced references only for verified peer-owned backends', async () => {
  const objects = new Map();
  const refs = new Map();
  const durableStore = {
    durable: true,
    ownership: 'peer-owned',
    async health({ namespace, peerId, operation = 'storage.health', objectHash = null, key = null }) {
      const claims = { version: 1, peerId, namespace, operation, objectHash, key,
        ownership: 'peer-owned', durable: true, atomicReferencesVerified: true,
        restartRecoveryVerified: true };
      return { ...claims, receipt: 'signed-test-receipt', receiptId: digest(encodeCanonical(claims)) };
    },
    async verifyDurabilityReceipt(receipt, claims) {
      return receipt === 'signed-test-receipt' && claims.peerId === 'capacity-peer' &&
        claims.namespace === 'PlanetApeX' && claims.restartRecoveryVerified === true &&
        claims.atomicReferencesVerified === true && typeof claims.operation === 'string' &&
        Object.hasOwn(claims, 'objectHash') && Object.hasOwn(claims, 'key');
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
  assert.equal(health.durable, true);
  assert.equal(health.ownership, 'peer-owned');
  assert.equal(health.recoveryVerified, true);
  assert.equal(health.restartRecoveryVerified, true);
  assert.equal(health.atomicReferencesVerified, true);
  assert.equal(typeof health.receiptId, 'string');
  assert.equal(health.receiptId.length, 64);

  const refBytes = Buffer.from('canonical reference bytes');
  const hash = digest(refBytes);
  const written = await handler({ protocol: 'apex.cas.v1', operation: 'ref.cas', namespace: 'PlanetApeX', key: 'root', expectedHash: null, hash, bytesBase64: refBytes.toString('base64') }, context);
  assert.equal(written.hash, hash);
  assert.equal(written.durable, true);
  const read = await handler({ protocol: 'apex.cas.v1', operation: 'ref.get', namespace: 'PlanetApeX', key: 'root' }, context);
  assert.equal(read.hash, hash);
  assert.equal(Buffer.from(read.bytesBase64, 'base64').toString(), refBytes.toString());
  await assert.rejects(
    handler({ protocol: 'apex.cas.v1', operation: 'ref.cas', namespace: 'PlanetApeX', key: 'root', expectedHash: null, hash, bytesBase64: refBytes.toString('base64') }, context),
    /compare-and-swap conflict/
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


test('bounded concurrent writes contact healthy peers while a stalled peer is cancelled', async () => {
  const mesh = makeMesh();
  mesh.stalled.add('peer-a');
  mesh.client.requestTimeoutMs = 80;
  const started = Date.now();
  await assert.rejects(mesh.client.putObject({ concurrent: true }), error =>
    error.code === 'INSUFFICIENT_REPLICAS' && error.verifiedReplicas === 1
  );
  assert.ok(Date.now() - started < 1000, 'request deadline must bound the stalled peer');
  assert.ok(mesh.stores.get('peer-b').objects.size > 0, 'healthy peer must receive the write without waiting for stalled peer');
});

test('a contradictory authenticated object hash aborts the entire write', async () => {
  const mesh = makeMesh();
  const original = mesh.transport.request.bind(mesh.transport);
  mesh.transport.request = async (peerId, envelope, options) => {
    const response = await original(peerId, envelope, options);
    if (peerId === 'peer-b' && envelope.operation === 'object.put') return { ...response, hash: 'f'.repeat(64) };
    return response;
  };
  await assert.rejects(mesh.client.putObject({ contradiction: true }), error =>
    error.code === 'CONTRADICTORY_REPLICA' && error.peerId === 'peer-b'
  );
});


test('immutable reads fail closed when any authenticated replica contradicts the requested content hash', async () => {
  const mesh = makeMesh();
  const written = await mesh.client.putObject({ integrity: 'immutable' });
  const original = mesh.transport.request.bind(mesh.transport);
  mesh.transport.request = async (peerId, envelope, options) => {
    const response = await original(peerId, envelope, options);
    if (peerId === 'peer-b' && envelope.operation === 'object.get') {
      return { ...response, hash: 'f'.repeat(64) };
    }
    return response;
  };
  await assert.rejects(mesh.client.getObject(written.hash), error =>
    error.code === 'CONTRADICTORY_REPLICA' && error.peerId === 'peer-b'
  );
});

test('reference reads require configured replica quorum even when one peer has a valid signed stale view', async () => {
  const mesh = makeMesh();
  const written = await mesh.client.putObject({ root: 'canonical' });
  await mesh.client.writeRef('main', { objectHash: written.hash }, { expectedHash: null });
  mesh.unavailable.add('peer-b');
  await assert.rejects(mesh.client.readRef('main'), error =>
    error.code === 'INSUFFICIENT_REPLICAS' && error.verifiedReplicas === 1
  );
});


test('peer CAS rejects forged, cross-peer, altered-hash, and altered-namespace receipts', async () => {
  const scenarios = ['forged-signature', 'cross-peer-signature', 'altered-hash', 'altered-namespace'];
  for (const scenario of scenarios) {
    const mesh = makeMesh();
    const originalRequest = mesh.transport.request.bind(mesh.transport);
    mesh.client.transport.request = async (peerId, request, options) => {
      const response = await originalRequest(peerId, request, options);
      if (peerId !== 'peer-a' || request.operation !== 'object.put') return response;
      if (scenario === 'forged-signature') {
        return { ...response, receipt: { ...response.receipt, signature: Buffer.alloc(64, 3).toString('base64') } };
      }
      if (scenario === 'cross-peer-signature') {
        const other = await originalRequest('peer-b', request, options);
        return { ...response, receipt: other.receipt, receiptId: other.receiptId };
      }
      if (scenario === 'altered-hash') {
        return { ...response, hash: 'f'.repeat(64) };
      }
      return { ...response, namespace: 'XShield' };
    };
    await assert.rejects(mesh.client.putObject({ scenario }), error =>
      error.code === 'INSUFFICIENT_REPLICAS' || error.code === 'CONTRADICTORY_REPLICA'
    , scenario);
  }
});
