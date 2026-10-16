import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { unlink } from 'node:fs/promises';
import { createPeerModelBridgeServer } from '../src/core/peer-model-bridge.mjs';
import { createKernelVisionPeerCanaryRouter } from '../src/api/kernelvision-peer-canary.mjs';

const token = 'test-only-kernelvision-peer-canary-token';
const socketPath = `/tmp/apex-kv-api-test-${process.pid}.sock`;

test('authenticated KernelVision API adapter writes and reads only through private peer CAS', async () => {
  const refs = new Map();
  const store = {
    namespace: 'KernelVision',
    async readRef(key) { return refs.get(key) || null; },
    async writeRef(key, value, { expectedHash }) {
      const current = refs.get(key);
      assert.equal(current?.hash ?? null, expectedHash);
      const hash = String(refs.size + 1).padStart(64, '0');
      const saved = { value, hash, replicas: ['peer-a', 'peer-b'], receipts: [{ peerId: 'peer-a' }, { peerId: 'peer-b' }] };
      refs.set(key, saved);
      return saved;
    },
    async getBlob() { return Buffer.alloc(0); }
  };
  const bridge = createPeerModelBridgeServer({ store, authorizeModel: async () => true, token, socketPath });
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use('/api/kernelvision/peer-canary', createKernelVisionPeerCanaryRouter({ socketPath, token, enabled: true }));
  const server = app.listen(0, '127.0.0.1');
  const listening = new Promise(resolve => server.once('listening', resolve));
  try {
    await bridge.listen();
    await listening;
    const base = `http://127.0.0.1:${server.address().port}/api/kernelvision/peer-canary/draft-1`;
    const write = await fetch(base, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: { title: 'unpublished' } }) });
    assert.equal(write.status, 200);
    const writePayload = await write.json();
    assert.equal(writePayload.replicas.length, 2);
    const read = await fetch(base);
    assert.equal(read.status, 200);
    assert.deepEqual((await read.json()).value, { title: 'unpublished' });
  } finally {
    server.close();
    await bridge.close();
    await unlink(socketPath).catch(() => {});
  }
});

test('KernelVision API adapter stays disabled by default', async () => {
  const app = express();
  app.use('/api/kernelvision/peer-canary', createKernelVisionPeerCanaryRouter({ enabled: false }));
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/kernelvision/peer-canary/draft-1`);
    assert.equal(response.status, 503);
  } finally {
    server.close();
  }
});
