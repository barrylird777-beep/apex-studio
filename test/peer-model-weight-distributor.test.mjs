import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { publishPeerModelWeights, fetchPeerModelWeights } from '../src/core/peer-model-weight-distributor.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function peerStore(namespace = 'KernelVision') {
  const blobs = new Map();
  return {
    namespace,
    async putBlob(bytes) {
      const copy = Buffer.from(bytes);
      const hash = sha256(copy);
      blobs.set(hash, copy);
      return { namespace, hash: 'a'.repeat(64), contentSha256: hash, totalBytes: copy.length, chunkCount: 2 };
    },
    async getBlob() {
      const value = [...blobs.values()][0];
      if (!value) throw new Error('peer object unavailable');
      return Buffer.from(value);
    }
  };
}

test('model weights publish and fetch only through namespace-scoped peer CAS with integrity verification', async () => {
  const store = peerStore();
  const source = Buffer.from('model-weight-bytes');
  const manifest = await publishPeerModelWeights(store, source, { modelId: 'smollm2', revision: 'r1' });
  assert.equal(manifest.kind, 'apex.model-weights.v1');
  assert.equal(manifest.contentSha256, sha256(source));
  const fetched = await fetchPeerModelWeights(store, manifest, {
    authorizeModel: ({ namespace, modelId, revision }) =>
      namespace === 'KernelVision' && modelId === 'smollm2' && revision === 'r1'
  });
  assert.deepEqual(fetched, source);
});

test('model weight fetch fails closed for unauthorized workers and cross-app manifests', async () => {
  const store = peerStore();
  const manifest = await publishPeerModelWeights(store, Buffer.from('weights'), { modelId: 'model-a', revision: 'r1' });
  await assert.rejects(fetchPeerModelWeights(store, manifest, { authorizeModel: () => false }), /access denied/);
  await assert.rejects(fetchPeerModelWeights(store, { ...manifest, namespace: 'KashKorner' }, {
    authorizeModel: () => true
  }), /cross-namespace/);
});

test('model weight fetch detects corrupted reconstructed bytes', async () => {
  const store = peerStore();
  const manifest = await publishPeerModelWeights(store, Buffer.from('correct'), { modelId: 'model-a', revision: 'r1' });
  store.getBlob = async () => Buffer.from('tampered');
  await assert.rejects(fetchPeerModelWeights(store, manifest, { authorizeModel: () => true }), /SHA-256 verification/);
});

test('model weight publish rejects missing model identity and empty input', async () => {
  const store = peerStore();
  await assert.rejects(publishPeerModelWeights(store, Buffer.from('x'), { modelId: '../bad', revision: 'r1' }), /modelId and revision/);
  await assert.rejects(publishPeerModelWeights(store, Buffer.alloc(0), { modelId: 'model-a', revision: 'r1' }), /empty/);
});
