import test from 'node:test';
import assert from 'node:assert/strict';
import { createPeerMediaStore, APEX_MEDIA_APPS } from '../src/core/peer-media-store.mjs';

function makePeerStore(namespace) {
  const blobs = new Map();
  return {
    namespace,
    async putBlob(input) {
      const bytes = Buffer.from(input);
      const contentSha256 = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
      const hash = contentSha256;
      blobs.set(hash, Buffer.from(bytes));
      return { hash, contentSha256, totalBytes: bytes.length, replicas: ['peer-a', 'peer-b'] };
    },
    async getBlob(hash) {
      if (!blobs.has(hash)) throw Object.assign(new Error('object unavailable'), { code: 'OBJECT_UNAVAILABLE' });
      return Buffer.from(blobs.get(hash));
    }
  };
}

function setup() {
  const peerStores = Object.fromEntries(APEX_MEDIA_APPS.map(app => [app, makePeerStore(app)]));
  const records = new Map();
  const refs = {
    async readRef(namespace, id) {
      const record = records.get(namespace + ':' + id);
      return record ? { value: structuredClone(record.value), hash: record.hash } : null;
    },
    async writeRef(namespace, id, value, { expectedHash } = {}) {
      const key = namespace + ':' + id;
      const current = records.get(key);
      if ((current?.hash ?? null) !== expectedHash) throw Object.assign(new Error('CAS mismatch'), { code: 'CAS_MISMATCH' });
      const hash = JSON.stringify(value);
      records.set(key, { value: structuredClone(value), hash });
      return { hash };
    }
  };
  return { media: createPeerMediaStore({ peerStores, refs }), peerStores };
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
