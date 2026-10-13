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


test('single-domain durability policy does not require failure-domain labels', async () => {
  const mesh = makeMesh();
  const client = new PeerContentAddressedStore({
    transport: mesh.client.transport,
    peers: ['peer-a', 'peer-b'],
    replicaCount: 2,
    minFailureDomains: 1,
    namespace: 'PlanetApeX',
    encryptionKey: Buffer.alloc(32, 7)
  });
  const receipt = await client.putObject({ noDomainMapNeeded: true });
  assert.equal(receipt.replicas.length, 2);
  assert.deepEqual(await client.getObject(receipt.hash), { noDomainMapNeeded: true });
});
