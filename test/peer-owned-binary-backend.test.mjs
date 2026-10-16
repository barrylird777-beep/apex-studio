import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { encodeCanonical } from '../src/core/apex-cbor.mjs';
import { createPeerOwnedBinaryBackend } from '../src/core/peer-owned-binary-backend.mjs';
import { PeerContentAddressedStore, createPeerObjectStorageHandler } from '../src/core/peer-content-addressed-store.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'apex-peer-cas-'));
  const priorRoot = process.env.APEX_PEER_OWNED_STORAGE_ROOT;
  const priorKey = process.env.APEX_PEER_STORAGE_RECEIPT_KEY_BASE64;
  process.env.APEX_PEER_OWNED_STORAGE_ROOT = root;
  process.env.APEX_PEER_STORAGE_RECEIPT_KEY_BASE64 = Buffer.alloc(32, 19).toString('base64');
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    if (priorRoot === undefined) delete process.env.APEX_PEER_OWNED_STORAGE_ROOT;
    else process.env.APEX_PEER_OWNED_STORAGE_ROOT = priorRoot;
    if (priorKey === undefined) delete process.env.APEX_PEER_STORAGE_RECEIPT_KEY_BASE64;
    else process.env.APEX_PEER_STORAGE_RECEIPT_KEY_BASE64 = priorKey;
  });
  const options = { peerId: 'peer-owner', namespaceAcl: 'PlanetApeX=writer-peer' };
  return { root, options, backend: await createPeerOwnedBinaryBackend(options) };
}

test('peer-owned binary backend survives backend re-instantiation and verifies CBOR bytes', async t => {
  const { root, options, backend } = await fixture(t);
  assert.equal(backend.capacityRoot, root, 'backend must expose the exact root used for capacity measurement');
  const bytes = encodeCanonical({ version: 1, binary: Buffer.from([0, 1, 2, 255]) });
  const id = hash(bytes);
  await backend.putBytes(id, bytes);
  const refBytes = encodeCanonical({ project: 'recovery-check', version: 1 });
  const refHash = hash(refBytes);
  await backend.writeRef('PlanetApeX', 'project-main', null, refHash, refBytes);

  const beforeRestartProof = await backend.health({ namespace: 'PlanetApeX', peerId: 'peer-owner' });
  const restarted = await createPeerOwnedBinaryBackend(options);
  assert.deepEqual(await restarted.getBytes(id), bytes);
  assert.deepEqual(await restarted.readRef('PlanetApeX', 'project-main'), { hash: refHash, bytes: refBytes });
  const proof = await restarted.health({ namespace: 'PlanetApeX', peerId: 'peer-owner' });
  assert.notEqual(proof.receiptId, beforeRestartProof.receiptId, 'a new backend instance must produce fresh recovery evidence');
  assert.equal(await restarted.verifyDurabilityReceipt(proof.receipt, {
    namespace: 'PlanetApeX', peerId: 'peer-owner',
    restartRecoveryVerified: true, atomicReferencesVerified: true
  }), true);
});

test('concurrent reference compare-and-swap allows exactly one writer', async t => {
  const { backend } = await fixture(t);
  const a = encodeCanonical({ value: 'writer-a' }), b = encodeCanonical({ value: 'writer-b' });
  const outcomes = await Promise.allSettled([
    backend.writeRef('PlanetApeX', 'shared-ref', null, hash(a), a),
    backend.writeRef('PlanetApeX', 'shared-ref', null, hash(b), b)
  ]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(item => item.status === 'rejected' && item.reason.code === 'REFERENCE_CONFLICT').length, 1);
});

test('corrupt immutable objects fail startup closed instead of being silently discarded', async t => {
  const { root, backend } = await fixture(t);
  const bytes = encodeCanonical({ object: 'valid' });
  const id = hash(bytes);
  await backend.putBytes(id, bytes);
  await writeFile(path.join(root, 'objects', id + '.bin'), Buffer.from('corrupted'));
  await assert.rejects(createPeerOwnedBinaryBackend({ peerId: 'peer-owner', namespaceAcl: 'PlanetApeX=writer-peer' }), /startup integrity failure/);
});

test('receipt is bound to peer and namespace; missing owner root fails closed', async t => {
  const { backend } = await fixture(t);
  await assert.rejects(backend.health({ namespace: 'XShield', peerId: 'peer-owner' }), /identity or ACL/);
  const saved = process.env.APEX_PEER_OWNED_STORAGE_ROOT;
  delete process.env.APEX_PEER_OWNED_STORAGE_ROOT;
  await assert.rejects(createPeerOwnedBinaryBackend({ peerId: 'peer-owner', namespaceAcl: 'PlanetApeX=writer-peer' }), /must explicitly name peer-owned/);
  process.env.APEX_PEER_OWNED_STORAGE_ROOT = saved;
});


test('durability receipt rejects validly signed mismatched or weakened claims', async t => {
  const { backend } = await fixture(t);
  const key = Buffer.from(process.env.APEX_PEER_STORAGE_RECEIPT_KEY_BASE64, 'base64');
  const sign = claims => {
    const body = encodeCanonical(claims);
    return { body: body.toString('base64'), mac: createHmac('sha256', key).update(body).digest('base64') };
  };
  const expected = {
    version: 1, peerId: 'peer-owner', namespace: 'PlanetApeX', ownership: 'peer-owned',
    durable: true, atomicReferencesVerified: true, restartRecoveryVerified: true,
    backendInstanceId: randomUUID(), verifiedAt: Date.now(), receiptNonce: randomUUID()
  };
  assert.equal(await backend.verifyDurabilityReceipt(sign(expected), expected), true);
  for (const weakened of [
    { ...expected, version: 2 },
    { ...expected, peerId: 'other-peer' },
    { ...expected, namespace: 'XShield' },
    { ...expected, ownership: 'coordinator-cache' },
    { ...expected, durable: false },
    { ...expected, atomicReferencesVerified: false },
    { ...expected, restartRecoveryVerified: false }
  ]) {
    assert.equal(await backend.verifyDurabilityReceipt(sign(weakened), expected), false);
  }
  const valid = sign(expected);
  assert.equal(await backend.verifyDurabilityReceipt(valid, { ...expected, namespace: 'KashKorner' }), false);
  const stale = sign({ ...expected, verifiedAt: Date.now() - 5 * 60_000 - 1 });
  assert.equal(await backend.verifyDurabilityReceipt(stale, expected), false, 'stale durability receipts must fail closed');
});


test('two independently persisted peers recover encrypted content after one peer disappears and the survivor restarts', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'apex-peer-loss-'));
  const priorRoot = process.env.APEX_PEER_OWNED_STORAGE_ROOT;
  const priorKey = process.env.APEX_PEER_STORAGE_RECEIPT_KEY_BASE64;
  process.env.APEX_PEER_STORAGE_RECEIPT_KEY_BASE64 = Buffer.alloc(32, 37).toString('base64');
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    if (priorRoot === undefined) delete process.env.APEX_PEER_OWNED_STORAGE_ROOT;
    else process.env.APEX_PEER_OWNED_STORAGE_ROOT = priorRoot;
    if (priorKey === undefined) delete process.env.APEX_PEER_STORAGE_RECEIPT_KEY_BASE64;
    else process.env.APEX_PEER_STORAGE_RECEIPT_KEY_BASE64 = priorKey;
  });

  const roots = { 'peer-a': path.join(root, 'peer-a'), 'peer-b': path.join(root, 'peer-b') };
  const options = peerId => ({ peerId, namespaceAcl: 'PlanetApeX=writer-peer' });
  const handlers = new Map();
  const online = new Map([['peer-a', true], ['peer-b', true]]);
  const startPeer = async peerId => {
    process.env.APEX_PEER_OWNED_STORAGE_ROOT = roots[peerId];
    const backend = await createPeerOwnedBinaryBackend(options(peerId));
    handlers.set(peerId, createPeerObjectStorageHandler({
      store: backend,
      peerId: peerId,
      authorizeNamespace: ({ remotePeerId, namespace }) => remotePeerId === 'writer-peer' && namespace === 'PlanetApeX'
    }));
  };
  await startPeer('peer-a');
  await startPeer('peer-b');

  const transport = {
    async request(peerId, request) {
      if (online.get(peerId) !== true) throw new Error('simulated peer unavailable: ' + peerId);
      const handler = handlers.get(peerId);
      if (!handler) throw new Error('peer handler unavailable: ' + peerId);
      return handler(request, { remotePeerId: 'writer-peer' });
    }
  };
  const client = new PeerContentAddressedStore({
    transport, peers: ['peer-a', 'peer-b'], replicaCount: 2, minFailureDomains: 2,
    failureDomainsByPeerId: { 'peer-a': 'device-a', 'peer-b': 'device-b' },
    namespace: 'PlanetApeX', encryptionKey: Buffer.alloc(32, 7)
  });
  const value = { project: 'survives-peer-loss', revision: 4, payload: 'peer-owned content' };
  const written = await client.putObject(value);
  assert.deepEqual(new Set(written.replicas), new Set(['peer-a', 'peer-b']));
  const ref = await client.writeRef('project-main', { objectHash: written.hash, revision: 4 }, { expectedHash: null });
  assert.deepEqual(new Set(ref.replicas), new Set(['peer-a', 'peer-b']));

  online.set('peer-a', false);
  await startPeer('peer-b'); // new backend instance; data is recovered from peer-b's independent root
  assert.deepEqual(await client.getObject(written.hash), value);
  assert.deepEqual((await client.readRef('project-main')).value, { objectHash: written.hash, revision: 4 });

  await assert.rejects(
    client.putObject({ mustNotBeAcknowledged: true }),
    error => error.code === 'INSUFFICIENT_REPLICAS' && error.verifiedReplicas === 1
  );
});
