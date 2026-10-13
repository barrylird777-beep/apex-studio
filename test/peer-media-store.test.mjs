import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPeerMediaStore, APEX_MEDIA_APPS } from '../src/core/peer-media-store.mjs';

function makePeerStore(namespace) {
  const blobs = new Map();
  const refs = new Map();
  return {
    namespace,
    async putBlob(input) {
      const bytes = Buffer.from(input);
      const contentSha256 = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
      const hash = createHash('sha256').update(Buffer.concat([Buffer.from(namespace), bytes])).digest('hex');
      blobs.set(hash, Buffer.from(bytes));
      return { hash, contentSha256, totalBytes: bytes.length, replicas: ['peer-a', 'peer-b'] };
    },
    async getBlob(hash) {
      if (!blobs.has(hash)) throw Object.assign(new Error('object unavailable'), { code: 'OBJECT_UNAVAILABLE' });
      return Buffer.from(blobs.get(hash));
    },
    async readRef(key) {
      const record = refs.get(key);
      return record ? { value: structuredClone(record.value), hash: record.hash } : null;
    },
    async writeRef(key, value, { expectedHash = null } = {}) {
      const current = refs.get(key);
      if ((current?.hash ?? null) !== expectedHash) throw Object.assign(new Error('CAS mismatch'), { code: 'CAS_CONFLICT' });
      const hash = createHash('sha256').update(JSON.stringify(value)).digest('hex');
      refs.set(key, { value: structuredClone(value), hash });
      return { hash };
    }
  };
}

function setup() {
  const peerStores = Object.fromEntries(APEX_MEDIA_APPS.map(app => [app, makePeerStore(app)]));
  return { media: createPeerMediaStore({ peerStores }), peerStores };
}

test('peer media store persists and verifies binary media', async () => {
  const { media } = setup();
  const input = Buffer.from([0, 1, 2, 3, 0, 255, 128]);
  const saved = await media.saveAsset('KernelVision', 'episode-1', 'master-video', input, { contentType: 'video/mp4' });
  assert.equal(saved.bytes, input.length);
  assert.equal(saved.sha256.length, 64);
  const loaded = await media.getAsset('KernelVision', 'episode-1', 'master-video');
  assert.deepEqual(loaded.bytes, input);
  assert.equal(loaded.record.contentType, 'video/mp4');
});

test('peer media store separates canonical app namespaces', async () => {
  const { media } = setup();
  await media.saveAsset('PlanetApeX', 'project-1', 'same-id', Buffer.from('Bible library'));
  await media.saveAsset('Kernelodies', 'project-1', 'same-id', Buffer.from('music library'));
  assert.equal((await media.getAsset('PlanetApeX', 'project-1', 'same-id')).bytes.toString(), 'Bible library');
  assert.equal((await media.getAsset('Kernelodies', 'project-1', 'same-id')).bytes.toString(), 'music library');
});

test('peer media store rejects unknown apps and empty assets', async () => {
  const { media } = setup();
  await assert.rejects(media.saveAsset('KoBlocks', 'project-1', 'asset-1', Buffer.from('x')), /Unknown canonical Apex app/);
  await assert.rejects(media.saveAsset('PlanetApeX', 'project-1', 'asset-1', Buffer.alloc(0)), /cannot be empty/);
});


test('concurrent project updates retry CAS conflicts without losing assets', async () => {
  const { media } = setup();
  await Promise.all([
    media.saveAsset('KashKorner', 'project-race', 'asset-a', Buffer.from('A')),
    media.saveAsset('KashKorner', 'project-race', 'asset-b', Buffer.from('B'))
  ]);
  const project = await media.getProject('KashKorner', 'project-race');
  assert.deepEqual(project.manifest.assets.map(asset => asset.id).sort(), ['asset-a', 'asset-b']);
});


test('storage facade routes project and scene media to peer storage in peer-only mode', async () => {
  const previousMode = process.env.APEX_STORAGE_MODE;
  const previousEnabled = process.env.APEX_PEER_STORAGE_ENABLED;
  process.env.APEX_STORAGE_MODE = 'peer';
  delete process.env.APEX_PEER_STORAGE_ENABLED;
  try {
    const { media } = setup();
    const storage = await import('../src/core/storage.mjs?peer-only-integration-test');
    storage.configurePeerMediaStorage(media, 'KernelVision');
    await storage.initStorage();
    const savedProject = await storage.saveProjectAsset('poster', Buffer.from('poster-bytes'), 'png');
    assert.equal(savedProject.url, '/api/peer-media/apex-project/poster');
    const savedScene = await storage.saveSceneAsset('scene-1', 'image', Buffer.from('scene-image'), 'png', { durationMs: 5000 });
    assert.equal(savedScene.url, '/api/peer-media/apex-scenes/scene-1-image');
    const loaded = await storage.getPeerMediaAsset('apex-scenes', 'scene-1-image');
    assert.equal(loaded.bytes.toString(), 'scene-image');
    const state = await storage.getProjectState();
    assert.equal(state.exports[0].type, 'poster');
    assert.equal(state.scenes[0].id, 'scene-1');
    assert.equal(state.scenes[0].durationMs, 5000);
  } finally {
    if (previousMode === undefined) delete process.env.APEX_STORAGE_MODE; else process.env.APEX_STORAGE_MODE = previousMode;
    if (previousEnabled === undefined) delete process.env.APEX_PEER_STORAGE_ENABLED; else process.env.APEX_PEER_STORAGE_ENABLED = previousEnabled;
  }
});

test('peer-only storage refuses to initialize without a configured peer runtime', async () => {
  const previousMode = process.env.APEX_STORAGE_MODE;
  const previousEnabled = process.env.APEX_PEER_STORAGE_ENABLED;
  process.env.APEX_STORAGE_MODE = 'peer';
  delete process.env.APEX_PEER_STORAGE_ENABLED;
  try {
    const storage = await import('../src/core/storage.mjs?peer-only-unconfigured-test');
    await assert.rejects(storage.initStorage(), error => error.code === 'PEER_STORAGE_NOT_CONFIGURED');
  } finally {
    if (previousMode === undefined) delete process.env.APEX_STORAGE_MODE; else process.env.APEX_STORAGE_MODE = previousMode;
    if (previousEnabled === undefined) delete process.env.APEX_PEER_STORAGE_ENABLED; else process.env.APEX_PEER_STORAGE_ENABLED = previousEnabled;
  }
});
