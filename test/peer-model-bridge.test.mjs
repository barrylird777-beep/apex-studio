import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { unlink, stat } from 'node:fs/promises';
import { createPeerModelBridgeServer } from '../src/core/peer-model-bridge.mjs';

const token = 'test-only-bridge-token-that-is-long-enough';
const bytes = Buffer.from('peer-owned model metadata');
const digest = createHash('sha256').update(bytes).digest('hex');
const socketPath = `/tmp/apex-peer-cas-test-${process.pid}.sock`;

function put(path, value, authorization = `Bearer ${token}`, targetSocketPath = socketPath) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(value));
    const req = request({ socketPath: targetSocketPath, path, method: 'PUT', headers: {
      authorization, 'content-type': 'application/json', 'content-length': body.length
    } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function get(path, authorization = `Bearer ${token}`, targetSocketPath = socketPath) {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath: targetSocketPath, path, method: 'GET', headers: { authorization } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('bridge rejects non-canonical app namespaces and dot-segment model identities', async () => {
  assert.throws(() => createPeerModelBridgeServer({
    store: { namespace: 'shared', readRef: async () => null, getBlob: async () => Buffer.alloc(0) },
    authorizeModel: async () => true, token, socketPath
  }), /canonical app namespace/);

  const store = { namespace: 'KernelVision', readRef: async () => null, getBlob: async () => Buffer.alloc(0) };
  const bridge = createPeerModelBridgeServer({ store, authorizeModel: async () => true, token, socketPath });
  try {
    await bridge.listen();
    const result = await get('/v1/peer-cas/models/model%2F../r1/manifest');
    assert.equal(result.status, 400);
  } finally {
    await bridge.close();
    await unlink(socketPath).catch(() => {});
  }
});

test('Unix socket bridge requires auth and serves only authorized, verified Peer-CAS bytes', async () => {
  const store = {
    namespace: 'KernelVision',
    readRef: async key => key === 'model-bundle.v1/test-model/r1'
      ? { value: { kind: 'apex.model-bundle.v1', namespace: 'KernelVision',
          modelId: 'test-model', revision: 'r1',
          files: [{ path: 'config.json', sha256: digest, size: bytes.length, blobManifestHash: 'manifest-hash' }] } }
      : null,
    getBlob: async key => key === 'manifest-hash' ? bytes : Buffer.alloc(0)
  };
  const bridge = createPeerModelBridgeServer({
    store,
    authorizeModel: async ({ namespace, modelId, revision }) =>
      namespace === 'KernelVision' && modelId === 'test-model' && revision === 'r1',
    token,
    socketPath
  });

  try {
    await bridge.listen();
    assert.equal((await stat(socketPath)).mode & 0o777, 0o600, 'socket permissions must be restrictive before listen resolves');
    const denied = await get('/v1/peer-cas/models/test-model/r1/manifest', 'Bearer wrong-token');
    assert.equal(denied.status, 401);

    const manifest = await get('/v1/peer-cas/models/test-model/r1/manifest');
    assert.equal(manifest.status, 200);
    assert.equal(JSON.parse(manifest.body.toString()).namespace, 'KernelVision');

    const blob = await get(`/v1/peer-cas/blobs/${digest}?model_id=test-model&revision=r1`);
    assert.equal(blob.status, 200);
    assert.deepEqual(blob.body, bytes);

    const forbidden = createPeerModelBridgeServer({
      store,
      authorizeModel: async () => false,
      token,
      socketPath: `/tmp/apex-peer-cas-denied-${process.pid}.sock`
    });
    const deniedPath = `/tmp/apex-peer-cas-denied-${process.pid}.sock`;
    try {
      await forbidden.listen();
      const result = await new Promise((resolve, reject) => {
        const req = request({ socketPath: deniedPath, path: '/v1/peer-cas/models/test-model/r1/manifest',
          method: 'GET', headers: { authorization: `Bearer ${token}` } }, res => {
          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
        });
        req.on('error', reject);
        req.end();
      });
      assert.equal(result.status, 403);
    } finally {
      await forbidden.close();
      await unlink(deniedPath).catch(() => {});
    }
  } finally {
    await bridge.close();
    await unlink(socketPath).catch(() => {});
  }
});


test('KernelVision canary stays disabled unless explicit opt-in is passed', async () => {
  const refs = new Map();
  let writes = 0;
  const store = {
    namespace: 'KernelVision',
    readRef: async key => refs.get(key) || null,
    writeRef: async (key, value, { expectedHash = null } = {}) => {
      writes++;
      const current = refs.get(key) || null;
      if ((current?.hash ?? null) !== expectedHash) throw new Error('CAS conflict');
      const hash = createHash('sha256').update(JSON.stringify(value)).digest('hex');
      refs.set(key, { value, hash });
      return { hash, replicas: ['peer-a', 'peer-b'], receipts: [] };
    },
    getBlob: async () => Buffer.alloc(0)
  };
  const disabledPath = `/tmp/apex-peer-cas-disabled-${process.pid}.sock`;
  const disabled = createPeerModelBridgeServer({ store, authorizeModel: async () => true, token, socketPath: disabledPath });
  try {
    await disabled.listen();
    assert.equal((await put('/v1/peer-cas/canary/flag', { value: 'must-not-write' }, `Bearer ${token}`, disabledPath)).status, 403);
    assert.equal((await get('/v1/peer-cas/canary/flag', `Bearer ${token}`, disabledPath)).status, 403);
    assert.equal(writes, 0);
  } finally {
    await disabled.close();
    await unlink(disabledPath).catch(() => {});
  }

  const enabledPath = `/tmp/apex-peer-cas-enabled-${process.pid}.sock`;
  const enabled = createPeerModelBridgeServer({
    store, authorizeModel: async () => true, token, socketPath: enabledPath,
    kernelVisionCanaryEnabled: true
  });
  try {
    await enabled.listen();
    const saved = await put('/v1/peer-cas/canary/flag', { value: 'peer-only' }, `Bearer ${token}`, enabledPath);
    assert.equal(saved.status, 200);
    assert.deepEqual(JSON.parse(saved.body.toString()).replicas, ['peer-a', 'peer-b']);
    const read = await get('/v1/peer-cas/canary/flag', `Bearer ${token}`, enabledPath);
    assert.equal(read.status, 200);
    assert.equal(JSON.parse(read.body.toString()).value, 'peer-only');
    assert.equal(writes, 1);
  } finally {
    await enabled.close();
    await unlink(enabledPath).catch(() => {});
  }
});
