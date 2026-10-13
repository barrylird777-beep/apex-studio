import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPeerStorageBackend } from '../src/core/peer-network-storage-backend.mjs';
import { encodeCanonical } from '../src/core/apex-cbor.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function upstreamHarness({ durable = true, ownership = 'peer-owned', recoveryVerified = true } = {}) {
  const objects = new Map();
  const refs = new Map();
  const peerNode = { dialProtocol() {}, peerId: { toString: () => 'writer-peer' } };
  const send = async (_node, _address, request) => {
    const base = { accepted: true, peerId: 'upstream-peer', namespace: request.namespace, durable, ownership, recoveryVerified };
    if (request.operation === 'storage.health') return base;
    if (request.operation === 'object.put') {
      const bytes = Buffer.from(request.bytesBase64, 'base64');
      if (sha256(bytes) !== request.hash) throw new Error('hash mismatch');
      objects.set(request.hash, bytes);
      return { ...base, hash: request.hash, bytes: bytes.length };
    }
    if (request.operation === 'object.get') {
      const bytes = objects.get(request.hash);
      if (!bytes) throw new Error('missing object');
      return { ...base, hash: request.hash, bytesBase64: bytes.toString('base64') };
    }
    if (request.operation === 'ref.get') {
      const item = refs.get(request.namespace + ':' + request.key);
      return item ? { ...base, hash: item.hash, bytesBase64: item.bytes.toString('base64') } : { ...base, hash: null };
    }
    if (request.operation === 'ref.cas') {
      const key = request.namespace + ':' + request.key;
      const current = refs.get(key);
      if ((current?.hash ?? null) !== request.expectedHash) throw Object.assign(new Error('CAS conflict'), { code: 'CAS_CONFLICT' });
      const bytes = Buffer.from(request.bytesBase64, 'base64');
      if (sha256(bytes) !== request.hash) throw new Error('reference hash mismatch');
      refs.set(key, { hash: request.hash, bytes });
      return { ...base, hash: request.hash };
    }
    throw new Error('unsupported request');
  };
  return { peerNode, send, objects, refs };
}

const env = {
  APEX_APP_ID: 'KernelVision',
  APEX_PEER_STORAGE_UPSTREAM: 'upstream-peer@/ip4/127.0.0.1/tcp/4001/p2p/upstream-peer'
};
const encryptedEnvelope = () => encodeCanonical({
  version: 1, algorithm: 'aes-256-gcm', namespace: 'KernelVision',
  iv: Buffer.alloc(12, 1).toString('base64'), tag: Buffer.alloc(16, 2).toString('base64'),
  ciphertext: Buffer.from('ciphertext-only').toString('base64')
});

test('network backend forwards verified binary objects and atomic refs without local persistence', async () => {
  const harness = upstreamHarness();
  const backend = await createPeerStorageBackend({ peerId: 'writer-peer', peerNode: harness.peerNode, env, send: harness.send });
  assert.equal(backend.durable, true);
  assert.equal(backend.ownership, 'peer-owned');
  const objectBytes = encryptedEnvelope();
  const hash = sha256(objectBytes);
  assert.deepEqual(await backend.putBytes(hash, objectBytes), { hash, bytes: objectBytes.length });
  assert.deepEqual(await backend.getBytes(hash), objectBytes);
  assert.equal(await backend.readRef('KernelVision', 'project-1'), null);
  const refBytes = encryptedEnvelope();
  const refHash = sha256(refBytes);
  assert.deepEqual(await backend.writeRef('KernelVision', 'project-1', null, refHash, refBytes), { hash: refHash });
  const read = await backend.readRef('KernelVision', 'project-1');
  assert.equal(read.hash, refHash);
  assert.deepEqual(read.bytes, refBytes);
  await assert.rejects(backend.readRef('PlanetApeX', 'project-1'), /cross-app/);
});

test('network backend refuses an upstream without durable peer-owned capacity', async () => {
  const harness = upstreamHarness({ durable: false, ownership: null, recoveryVerified: false });
  await assert.rejects(
    createPeerStorageBackend({ peerId: 'writer-peer', peerNode: harness.peerNode, env, send: harness.send }),
    /did not prove durable peer-owned/
  );
});

test('network backend refuses wrong upstream identity and mismatched hashes', async () => {
  const harness = upstreamHarness();
  await assert.rejects(
    createPeerStorageBackend({
      peerId: 'writer-peer',
      peerNode: harness.peerNode,
      env: { ...env, APEX_PEER_STORAGE_UPSTREAM: 'other-peer@/ip4/127.0.0.1/tcp/4001/p2p/wrong-peer' },
      send: harness.send
    }),
    /exact upstream peer ID/
  );
  const backend = await createPeerStorageBackend({
    peerId: 'writer-peer', peerNode: harness.peerNode, env,
    send: async (_node, _address, request) => ({ accepted: true, peerId: 'upstream-peer', namespace: request.namespace, durable: true, ownership: 'peer-owned', recoveryVerified: true })
  });
  const bytes = encryptedEnvelope();
  await assert.rejects(backend.putBytes(sha256(bytes), bytes), /object receipt did not prove durable/);
});
