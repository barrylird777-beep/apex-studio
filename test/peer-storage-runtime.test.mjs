import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PeerContentAddressedStore } from '../src/core/peer-content-addressed-store.mjs';
import { initializePeerObjectStorage } from '../src/core/peer-storage-runtime.mjs';
import { createPeerStorageAssembly } from '../src/core/peer-storage-assembly.mjs';

function binaryMemoryStore() {
  const objects = new Map();
  const refs = new Map();
  return {
    objects, refs,
    async putBytes(hash, input) {
      const bytes = Buffer.from(input);
      if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('hash mismatch');
      objects.set(hash, Buffer.from(bytes));
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
      const id = namespace + ':' + key;
      const current = refs.get(id);
      if ((current?.hash ?? null) !== expectedHash) throw Object.assign(new Error('CAS mismatch'), { code: 'CAS_CONFLICT' });
      const bytes = Buffer.from(input);
      if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('reference hash mismatch');
      refs.set(id, { hash, bytes });
      return { hash };
    }
  };
}

test('peer object storage stays disabled unless explicitly enabled', async () => {
  const runtime = await initializePeerObjectStorage({ enabled: false });
  assert.equal(runtime.enabled, false);
  await assert.rejects(runtime.handle({}, { remotePeerId: 'writer-peer' }), /disabled/);
});

test('peer object storage requires an injected binary backend and canonical explicit namespace ACL', async () => {
  await assert.rejects(
    initializePeerObjectStorage({ enabled: true, namespaceAcl: 'PlanetApeX=writer-peer', peerId: () => 'storage-peer' }),
    /injected peer-owned binary backend/
  );
  await assert.rejects(
    initializePeerObjectStorage({ enabled: true, store: binaryMemoryStore(), namespaceAcl: 'KoBlocks=writer-peer', peerId: () => 'storage-peer' }),
    /non-canonical app/
  );
  await assert.rejects(
    initializePeerObjectStorage({ enabled: true, store: binaryMemoryStore(), namespaceAcl: '', peerId: () => 'storage-peer' }),
    /ACL is empty/
  );
});

test('opt-in runtime stores encrypted bytes through an injected backend and enforces namespace ACL', async () => {
  const store = binaryMemoryStore();
  const runtime = await initializePeerObjectStorage({
    enabled: true,
    store,
    namespaceAcl: 'PlanetApeX=writer-peer',
    peerId: () => 'storage-peer'
  });
  const client = new PeerContentAddressedStore({
    transport: { request: async (_peerId, envelope) => runtime.handle(envelope, { remotePeerId: 'writer-peer' }) },
    peers: ['storage-peer'],
    replicaCount: 1,
    failureDomainsByPeerId: { 'storage-peer': 'test-domain-storage-peer' },
    namespace: 'PlanetApeX',
    encryptionKey: Buffer.alloc(32, 23)
  });
  const value = { privateTitle: 'unpublished manuscript', app: 'PlanetApeX' };
  const receipt = await client.putObject(value);
  assert.equal(receipt.replicas[0], 'storage-peer');
  assert.deepEqual(await client.getObject(receipt.hash), value);
  const storedBytes = store.objects.get(receipt.hash);
  assert.equal(Buffer.isBuffer(storedBytes), true);
  assert.equal(storedBytes.includes(Buffer.from('unpublished manuscript')), false);
  await assert.rejects(
    runtime.handle({ protocol: 'apex.cas.v1', operation: 'object.get', namespace: 'PlanetApeX', hash: receipt.hash }, { remotePeerId: 'unlisted-peer' }),
    /namespace access denied/
  );
});


test('peer object storage provides encrypted atomic references with compare-and-swap', async () => {
  const store = binaryMemoryStore();
  const runtime = await initializePeerObjectStorage({
    enabled: true, store, namespaceAcl: 'PlanetApeX=writer-peer', peerId: () => 'storage-peer'
  });
  const client = new PeerContentAddressedStore({
    transport: { request: async (_peerId, envelope) => runtime.handle(envelope, { remotePeerId: 'writer-peer' }) },
    peers: ['storage-peer'], replicaCount: 1, namespace: 'PlanetApeX', encryptionKey: Buffer.alloc(32, 19)
  });
  assert.equal(await client.readRef('project-1'), null);
  const saved = await client.writeRef('project-1', { title: 'private project' }, { expectedHash: null });
  assert.deepEqual((await client.readRef('project-1')).value, { title: 'private project' });
  await assert.rejects(
    client.writeRef('project-1', { title: 'stale overwrite' }, { expectedHash: null }),
    error => error.code === 'CAS_CONFLICT'
  );
  assert.deepEqual((await client.readRef('project-1')).value, { title: 'private project' });
  assert.equal(saved.replicas[0], 'storage-peer');
});

test('peer storage assembly fails closed when no durable peer-owned backend is configured', async () => {
  const peerNode = { dialProtocol() {}, peerId: { toString: () => 'local-peer' } };
  await assert.rejects(
    createPeerStorageAssembly({ peerNode, env: {} }),
    /APEX_PEER_STORAGE_BACKEND_MODULE/
  );
});
