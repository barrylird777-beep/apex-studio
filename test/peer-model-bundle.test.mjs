import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { publishPeerModelBundle, fetchPeerModelBundle } from '../src/core/peer-model-bundle.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function memoryPeerCAS() {
  const blobs = new Map();
  const refs = new Map();
  return {
    namespace: 'KernelVision',
    async putBlob(bytes) {
      const data = Buffer.from(bytes);
      const hash = sha256(data);
      blobs.set(hash, data);
      return { hash, namespace: this.namespace, contentSha256: hash, totalBytes: data.length, chunkCount: 1 };
    },
    async getBlob(hash) {
      if (!blobs.has(hash)) throw new Error('missing peer blob');
      return Buffer.from(blobs.get(hash));
    },
    async readRef(key) { return refs.get(key) || null; },
    async writeRef(key, value, { expectedHash }) {
      const current = refs.get(key) || null;
      if ((current?.hash ?? null) !== expectedHash) throw new Error('reference compare-and-swap conflict');
      const hash = sha256(Buffer.from(JSON.stringify(value)));
      refs.set(key, { hash, value });
      return { hash };
    }
  };
}

const assets = () => [
  { path: 'config.json', bytes: Buffer.from('{"model_type":"qwen2"}') },
  { path: 'tokenizer.json', bytes: Buffer.from('{"version":"1.0"}') },
  { path: 'model-00001-of-00001.safetensors', bytes: Buffer.from('test weights bytes') }
];

test('publishes and reconstructs a complete namespace-scoped model bundle from peer CAS', async () => {
  const store = memoryPeerCAS();
  const published = await publishPeerModelBundle(store, assets(), {
    modelId: 'Qwen/Qwen2.5-Coder-32B-Instruct', revision: 'test-r1'
  });
  assert.equal(published.files.length, 3);
  const recovered = await fetchPeerModelBundle(store, {
    modelId: published.modelId, revision: published.revision,
    authorizeModel: ({ namespace }) => namespace === 'KernelVision'
  });
  assert.equal(recovered.files.get('config.json').toString(), '{"model_type":"qwen2"}');
  assert.deepEqual([...recovered.files.keys()].sort(), [
    'config.json', 'model-00001-of-00001.safetensors', 'tokenizer.json'
  ]);
});

test('refuses unauthorized model bundle reads', async () => {
  const store = memoryPeerCAS();
  await publishPeerModelBundle(store, assets(), { modelId: 'example/model', revision: 'r1' });
  await assert.rejects(fetchPeerModelBundle(store, {
    modelId: 'example/model', revision: 'r1', authorizeModel: () => false
  }), /access denied/);
});

test('rejects unsafe asset paths before publishing any bundle', async () => {
  const store = memoryPeerCAS();
  await assert.rejects(publishPeerModelBundle(store, [
    { path: 'config.json', bytes: Buffer.from('{}') },
    { path: 'tokenizer.json', bytes: Buffer.from('{}') },
    { path: '../weights.safetensors', bytes: Buffer.from('x') }
  ], { modelId: 'example/model', revision: 'r1' }), /invalid or duplicate/);
});


test('rejects SentencePiece-only bundles before publishing because the in-memory adapter requires tokenizer.json', async () => {
  const store = memoryPeerCAS();
  const unsupported = assets().filter(file => file.path !== 'tokenizer.json');
  unsupported.push({ path: 'tokenizer.model', bytes: Buffer.from('sentencepiece bytes') });
  await assert.rejects(publishPeerModelBundle(store, unsupported, {
    modelId: 'model-a', revision: 'r1'
  }), /tokenizer.json/);
});
