import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { unlink } from 'node:fs/promises';
import { createPeerModelBridgeServer } from '../src/core/peer-model-bridge.mjs';

const token = 'test-only-canary-bridge-token-long-enough';
const socketPath = `/tmp/apex-peer-canary-test-${process.pid}.sock`;

function call(method, path, body, authorization = `Bearer ${token}`) {
  return new Promise((resolve, reject) => {
    const bytes = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
    const req = request({
      socketPath, path, method,
      headers: { authorization, ...(bytes.length ? { 'content-type': 'application/json', 'content-length': bytes.length } : {}) }
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

test('KernelVision peer bridge canary uses atomic peer CAS refs and rejects other namespaces', async () => {
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
  try {
    await bridge.listen();
    const written = await call('PUT', '/v1/peer-cas/canary/draft-1', { value: { title: 'unpublished' } });
    assert.equal(written.status, 200);
    assert.equal(JSON.parse(written.body).replicas.length, 2);
    const read = await call('GET', '/v1/peer-cas/canary/draft-1');
    assert.equal(read.status, 200);
    assert.deepEqual(JSON.parse(read.body).value, { title: 'unpublished' });
    assert.equal((await call('PUT', '/v1/peer-cas/canary/../unsafe', { value: 1 })).status, 404);
    assert.equal((await call('GET', '/v1/peer-cas/canary/draft-1', undefined, 'Bearer bad')).status, 401);
  } finally {
    await bridge.close();
    await unlink(socketPath).catch(() => {});
  }
});

test('KernelVision peer bridge does not expose canary route for another app namespace', async () => {
  const bridge = createPeerModelBridgeServer({
    store: { namespace: 'PlanetApeX', readRef: async () => null, getBlob: async () => Buffer.alloc(0) },
    authorizeModel: async () => true, token, socketPath
  });
  try {
    await bridge.listen();
    assert.equal((await call('GET', '/v1/peer-cas/canary/draft-1')).status, 403);
  } finally {
    await bridge.close();
    await unlink(socketPath).catch(() => {});
  }
});
