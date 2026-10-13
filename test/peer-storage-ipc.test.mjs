import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createPeerStorageIpcClient, createPeerStorageIpcServer } from '../src/core/peer-storage-ipc.mjs';

const apps = ['PlanetApeX', 'XShield', 'KernelVision', 'Kernelodies', 'KashKorner', 'KoinKob'];

test('peer storage IPC uses authenticated binary CBOR for media calls', async () => {
  const token = randomBytes(32).toString('base64url');
  const saved = new Map();
  const mediaStore = {
    apps,
    async saveAsset(app, projectId, assetId, bytes, options) {
      const key = [app, projectId, assetId].join(':');
      const record = { app, projectId, assetId, bytes: bytes.length, contentType: options.contentType };
      saved.set(key, { record, bytes: Buffer.from(bytes) });
      return record;
    },
    async getAsset(app, projectId, assetId) {
      const value = saved.get([app, projectId, assetId].join(':'));
      return value ? { record: value.record, bytes: Buffer.from(value.bytes) } : null;
    },
    async getProject(app, projectId) { return { manifest: { app, projectId, assets: [] }, hash: null }; }
  };
  const bridge = createPeerStorageIpcServer({ mediaStore, token, port: 0 });
  const address = await bridge.listen();
  try {
    const client = createPeerStorageIpcClient({ token, port: address.port });
    const bytes = Buffer.from([0, 1, 2, 255, 128, 10]);
    const record = await client.saveAsset('KernelVision', 'project-a', 'asset-a', bytes, { contentType: 'video/mp4', metadata: { title: 'test' } });
    assert.equal(record.bytes, bytes.length);
    const asset = await client.getAsset('KernelVision', 'project-a', 'asset-a');
    assert.deepEqual(asset.bytes, bytes);
    assert.equal(asset.record.contentType, 'video/mp4');
    const project = await client.getProject('KernelVision', 'project-a');
    assert.equal(project.manifest.app, 'KernelVision');
  } finally {
    await bridge.close();
  }
});

test('peer storage IPC rejects invalid tokens and non-loopback binding', async () => {
  const mediaStore = { apps, saveAsset: async () => null, getAsset: async () => null, getProject: async () => null };
  assert.throws(() => createPeerStorageIpcServer({ mediaStore, token: 'short' }), /at least 32 bytes/);
  assert.throws(() => createPeerStorageIpcServer({ mediaStore, token: randomBytes(32).toString('base64url'), host: '0.0.0.0' }), /loopback only/);
});
