import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PeerContentAddressedStore } from '../src/core/peer-content-addressed-store.mjs';
import { initializePeerObjectStorage } from '../src/core/peer-storage-runtime.mjs';

function binaryMemoryStore() {
  const objects = new Map();
  return {
    objects,
    async putBytes(hash, input) {
      const bytes = Buffer.from(input);
      if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('hash mismatch');
      objects.set(hash, Buffer.from(bytes));
      return { hash, bytes: bytes.length };
    },
    async getBytes(hash) {
      if (!objects.has(hash)) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      return Buffer.from(objects.get(hash));
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
    if (transactions.has(transactionId)) {
      const prior = transactions.get(transactionId);
      return { transactionId, state: prior.state, hash: prior.hash };
    }
    if ((refs.get(namespace + ':' + key)?.hash ?? null) !== expectedHash) throw new Error('prepare conflict');
    await store.putBytes(hash, bytes);
    const tx = { transactionId, namespace, key, expectedHash, hash, bytes: Buffer.from(bytes), participants: [...participants].sort(), state: 'prepared' };
    transactions.set(transactionId, tx);
    return { transactionId, state: tx.state, hash };
  };
  store.decideRefCommit = async (transactionId, participants) => {
    const tx = transactions.get(transactionId);
    if (!tx || JSON.stringify([...participants].sort()) !== JSON.stringify(tx.participants)) throw new Error('prepare/participant mismatch');
    if (tx.state === 'prepared') tx.state = 'commit-decided';
    return { transactionId, state: tx.state, hash: tx.hash };
  };
  store.commitPreparedRef = async transactionId => {
    const tx = transactions.get(transactionId);
    if (!tx || !['commit-decided', 'committed'].includes(tx.state)) throw new Error('missing commit decision');
    const current = refs.get(tx.namespace + ':' + tx.key);
    if ((current?.hash ?? null) === tx.expectedHash) refs.set(tx.namespace + ':' + tx.key, { hash: tx.hash, bytes: Buffer.from(tx.bytes) });
    else if (current?.hash !== tx.hash) throw new Error('commit divergence');
    tx.state = 'committed';
    return { transactionId, state: tx.state, hash: tx.hash };
  };
  store.abortPreparedRef = async transactionId => {
    const tx = transactions.get(transactionId);
    if (!tx) return { transactionId, state: 'absent' };
    if (tx.state !== 'prepared' && tx.state !== 'aborted') throw new Error('cannot abort decided transaction');
    tx.state = 'aborted';
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
  store.listRefs = async namespace => [...refs.entries()]
    .filter(([refKey]) => refKey.startsWith(namespace + ':'))
    .map(([refKey, ref]) => ({ key: refKey.slice(namespace.length + 1), hash: ref.hash, bytes: Buffer.from(ref.bytes) }));
  store.health = async ({ namespace, peerId }) => ({
    durable: true, ownership: 'peer-owned', restartRecoveryVerified: true,
    atomicReferencesVerified: true, peerId, namespace,
    receipt: 'signed-test-receipt', receiptId: 'peer-proof-runtime'
  });
  store.verifyDurabilityReceipt = async (receipt, claims) =>
    receipt === 'signed-test-receipt' && claims.peerId === 'storage-peer' &&
    claims.namespace === 'PlanetApeX' && claims.restartRecoveryVerified === true &&
    claims.atomicReferencesVerified === true;
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
  const referenceValue = { objectHash: receipt.hash, revision: 1 };
  const reference = await client.writeRef('library-main', referenceValue, { expectedHash: null });
  assert.equal(reference.hash.length, 64);
  assert.deepEqual(await client.listRefs(), [
    { namespace: 'PlanetApeX', key: 'library-main', hash: reference.hash, value: referenceValue }
  ]);
  const storedBytes = store.objects.get(receipt.hash);
  assert.equal(Buffer.isBuffer(storedBytes), true);
  assert.equal(storedBytes.includes(Buffer.from('unpublished manuscript')), false);
  await assert.rejects(
    runtime.handle({ protocol: 'apex.cas.v1', operation: 'object.get', namespace: 'PlanetApeX', hash: receipt.hash }, { remotePeerId: 'unlisted-peer' }),
    /namespace access denied/
  );
});
