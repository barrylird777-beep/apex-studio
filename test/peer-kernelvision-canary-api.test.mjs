import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { request } from 'node:http';
import { unlink } from 'node:fs/promises';
import { createPeerModelBridgeServer } from '../src/core/peer-model-bridge.mjs';
import { createKernelVisionPeerCanaryRouter } from '../src/api/kernelvision-peer-canary.mjs';

const token = 'test-only-kernelvision-api-bridge-token';
const socketPath = `/tmp/apex-kv-api-test-${process.pid}.sock`;

function call(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const bytes = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
    const req = request({ host: '127.0.0.1', port, path, method,
      headers: { ...(bytes.length ? { 'content-type': 'application/json', 'content-length': bytes.length } : {}) }
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (bytes.length) req.write(bytes);
    req.end();
  });
}

test('KernelVision API canary routes writes and reads through private Peer-CAS socket', async () => {
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
  try {
    await bridge.listen();
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const port = server.address().port;
    const written = await call(port, 'PUT', '/api/kernelvision/peer-canary/test-record', { value: { marker: 'non-production' } });
    assert.equal(written.status, 200, written.body);
    assert.deepEqual(JSON.parse(written.body).replicas, ['peer-a', 'peer-b']);
    const read = await call(port, 'GET', '/api/kernelvision/peer-canary/test-record');
    assert.equal(read.status, 200, read.body);
    assert.deepEqual(JSON.parse(read.body).value, { marker: 'non-production' });
    const disabled = createKernelVisionPeerCanaryRouter({ socketPath, token, enabled: false });
    const disabledApp = express();
    disabledApp.use('/api/kernelvision/peer-canary', disabled);
    const disabledServer = disabledApp.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { disabledServer.once('listening', resolve); disabledServer.once('error', reject); });
    try {
      const blocked = await call(disabledServer.address().port, 'GET', '/api/kernelvision/peer-canary/test-record');
      assert.equal(blocked.status, 503);
    } finally {
      await new Promise(resolve => disabledServer.close(resolve));
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    await bridge.close();
    await unlink(socketPath).catch(() => {});
  }
});
