import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import http from 'node:http';
import { createPeerStorageApiBridge, APEX_APPS } from '../src/core/peer-storage-api-bridge.mjs';
import { PeerStorageApiClient } from '../src/core/peer-storage-api-client.mjs';

function fakeStore(namespace) {
  const refs = new Map();
  const blobs = new Map();
  return {
    namespace,
    cas: {
      namespace,
      async readRef(ns, key) {
        assert.equal(this.namespace, namespace);
        const value = refs.get(ns + '/' + key);
        return value ? structuredClone(value) : null;
      },
      async writeRef(ns, key, value, { expectedHash = null } = {}) {
        assert.equal(this.namespace, namespace);
        const id = ns + '/' + key;
        const current = refs.get(id);
        if ((current?.hash ?? null) !== expectedHash) {
          const error = new Error('CAS conflict'); error.code = 'CAS_CONFLICT'; throw error;
        }
        const hash = randomUUID().replaceAll('-', '').padEnd(64, '0');
        refs.set(id, { value: structuredClone(value), hash });
        return { hash };
      },
      async listRefs(ns) {
        return [...refs].filter(([key]) => key.startsWith(ns + '/')).map(([key, value]) => ({
          namespace, key: key.slice(ns.length + 1), ...structuredClone(value)
        }));
      },
      async deleteRef(ns, key, { expectedHash = null } = {}) {
        const id = ns + '/' + key, current = refs.get(id);
        if (!current) return false;
        if (expectedHash && expectedHash !== current.hash) throw Object.assign(new Error('CAS conflict'), { code: 'CAS_CONFLICT' });
        refs.delete(id); return true;
      }
    },
    objects: {
      namespace,
      async putBlob(bytes) { const hash = randomUUID().replaceAll('-', '').padEnd(64, '0'); blobs.set(hash, Buffer.from(bytes)); const replicas = ['test-peer-a-' + namespace, 'test-peer-b-' + namespace]; return { hash, bytes: bytes.length, namespace, replicas, receipts: replicas.map((peerId, index) => ({ hash, bytes: bytes.length, namespace, peerId, receiptId: 'test-receipt-' + index + '-' + hash })) }; },
      async getBlob(hash) { const bytes = blobs.get(hash); if (!bytes) throw new Error('missing fake blob'); return Buffer.from(bytes); }
    }
  };
}

function request(socketPath, token, body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const req = http.request({ socketPath, path: '/v1/storage', method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'content-length': payload.length } },
    res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    req.on('error', reject); req.end(payload);
  });
}

test('peer API bridge requires auth and keeps app references in separate stores', async () => {
  const tokens = Object.fromEntries(APEX_APPS.map(app => [app, 'test-token-' + app + '-' + randomUUID().repeat(2)]));
  const socketPath = '/tmp/apex-storage-bridge-test-' + randomUUID() + '.sock';
  const stores = Object.fromEntries(APEX_APPS.map(app => [app, fakeStore(app)]));
  const bridge = createPeerStorageApiBridge({
    stores, tokens, socketPath,
    authorize: async ({ app, operation }) => {
      if (!APEX_APPS.includes(app) || !['readRef', 'writeRef', 'listRefs', 'deleteRef', 'putBlob', 'getBlob'].includes(operation)) {
        throw Object.assign(new Error('test tensor denied operation'), { code: 'ACCESS_DENIED' });
      }
      return { allowed: true, testPolicy: true };
    }
  });
  try {
    await bridge.listen();
    assert.equal((await request(socketPath, 'wrong-token', { app: 'KernelVision', operation: 'listRefs', args: { namespace: 'state' } })).status, 401);
    const write = await request(socketPath, tokens.KernelVision, { app: 'KernelVision', operation: 'writeRef',
      args: { namespace: 'state', key: 'item-1', value: { marker: 'only-kernelvision' }, expectedHash: null } });
    assert.equal(write.status, 200);
    const own = await request(socketPath, tokens.KernelVision, { app: 'KernelVision', operation: 'readRef',
      args: { namespace: 'state', key: 'item-1' } });
    assert.equal(own.body.result.value.marker, 'only-kernelvision');
    const previousApp = process.env.APEX_APP_NAMESPACE;
    process.env.APEX_APP_NAMESPACE = 'KernelVision';
    const client = new PeerStorageApiClient({ token: tokens.KernelVision, socketPath });
    if (previousApp === undefined) delete process.env.APEX_APP_NAMESPACE; else process.env.APEX_APP_NAMESPACE = previousApp;
    await assert.rejects(client.writeRef('state', 'item-1', { marker: 'stale' }, { expectedHash: '0'.repeat(64) }),
      error => error.code === 'CAS_CONFLICT');
    // Exhaustively check every credential against every other canonical app.
    for (const sourceApp of APEX_APPS) {
      for (const targetApp of APEX_APPS) {
        if (sourceApp === targetApp) continue;
        const denied = await request(socketPath, tokens[sourceApp], { app: targetApp, operation: 'readRef',
          args: { namespace: 'state', key: 'item-1' } });
        assert.equal(denied.status, 401, `${sourceApp} credential must not access ${targetApp}`);
      }
    }
    const other = await request(socketPath, tokens.XShield, { app: 'XShield', operation: 'readRef',
      args: { namespace: 'state', key: 'item-1' } });
    assert.equal(other.body.result, null);
    const invalid = await request(socketPath, tokens.KernelVision, { app: 'not-an-app', operation: 'listRefs', args: { namespace: 'state' } });
    assert.equal(invalid.status, 403);
  } finally {
    await bridge.close();
    await rm(socketPath, { force: true }).catch(() => {});
  }
});



test('peer storage bridge denies tensor-rejected operations before mutating CAS', async () => {
  const tokens = Object.fromEntries(APEX_APPS.map(app => [app, 'test-token-' + app + '-' + randomUUID().repeat(2)]));
  const socketPath = '/tmp/apex-storage-deny-test-' + randomUUID() + '.sock';
  const stores = Object.fromEntries(APEX_APPS.map(app => [app, fakeStore(app)]));
  let authorizationCalls = 0;
  const bridge = createPeerStorageApiBridge({
    stores, tokens, socketPath,
    authorize: async ({ app, operation, args }) => {
      authorizationCalls++;
      assert.equal(app, 'KernelVision');
      assert.ok(['writeRef', 'readRef'].includes(operation));
      assert.equal(args.key, 'blocked-record');
      throw Object.assign(new Error('tensor deny'), { code: 'ACCESS_DENIED' });
    }
  });
  try {
    await bridge.listen();
    const denied = await request(socketPath, tokens.KernelVision, {
      app: 'KernelVision', operation: 'writeRef',
      args: { namespace: 'state', key: 'blocked-record', value: { secret: true }, expectedHash: null }
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'ACCESS_DENIED');
    assert.equal(authorizationCalls, 1);
    const readback = await request(socketPath, tokens.KernelVision, {
      app: 'KernelVision', operation: 'readRef', args: { namespace: 'state', key: 'blocked-record' }
    });
    assert.equal(readback.status, 403, 'the same denying tensor also blocks readback');
    assert.equal(authorizationCalls, 2);
  } finally {
    await bridge.close();
    await rm(socketPath, { force: true }).catch(() => {});
  }
});

test('API client chunks and verifies large binary assets through peer bridge', async () => {
  const tokens = Object.fromEntries(APEX_APPS.map(app => [app, 'test-token-' + app + '-' + randomUUID().repeat(2)]));
  const socketPath = '/tmp/apex-storage-blob-test-' + randomUUID() + '.sock';
  const stores = Object.fromEntries(APEX_APPS.map(app => [app, fakeStore(app)]));
  const bridge = createPeerStorageApiBridge({
    stores, tokens, socketPath,
    authorize: async ({ app, operation }) => {
      if (!APEX_APPS.includes(app) || !['readRef', 'writeRef', 'listRefs', 'deleteRef', 'putBlob', 'getBlob'].includes(operation)) {
        throw Object.assign(new Error('test tensor denied operation'), { code: 'ACCESS_DENIED' });
      }
      return { allowed: true, testPolicy: true };
    }
  });
  try {
    await bridge.listen();
    const previousApp = process.env.APEX_APP_NAMESPACE;
    process.env.APEX_APP_NAMESPACE = 'KernelVision';
    const client = new PeerStorageApiClient({ token: tokens.KernelVision, socketPath, chunkSize: 8 * 1024 });
    if (previousApp === undefined) delete process.env.APEX_APP_NAMESPACE; else process.env.APEX_APP_NAMESPACE = previousApp;
    const boundedClient = new PeerStorageApiClient({ token: tokens.KernelVision, socketPath, maxAssetBytes: 1024 });
    await assert.rejects(boundedClient.putBlob(Buffer.alloc(1025)), error => error.code === 'ASSET_TOO_LARGE');
    const input = Buffer.alloc(1024 * 1024 + 37);
    for (let i = 0; i < input.length; i++) input[i] = i % 251;
    const stored = await client.putBlob(input);
    assert.equal(stored.bytes, input.length);
    const recovered = await client.getBlob(stored.hash);
    assert.deepEqual(recovered, input);
    assert.equal(client.cacheMetrics.misses, 1, 'first verified read populates the disposable RAM cache');
    recovered.fill(0);
    const cachedAgain = await client.getBlob(stored.hash);
    assert.deepEqual(cachedAgain, input, 'callers cannot mutate the cached payload');
    assert.equal(client.cacheMetrics.hits, 1, 'second immutable CID read is served from verified RAM');
    assert.ok(client.verifiedAssetCacheBytes <= client.cacheMaxBytes, 'RAM cache stays within its byte budget');
    client.verifiedAssetCache.get(stored.hash).expiresAt = Date.now() - 1;
    const afterExpiry = await client.getBlob(stored.hash);
    assert.deepEqual(afterExpiry, input, 'expired cache entries are re-fetched and re-verified from peers');
    assert.equal(client.cacheMetrics.expirations, 1, 'expired entries are removed from RAM');
  } finally {
    await bridge.close();
    await rm(socketPath, { force: true }).catch(() => {});
  }
});


import { generateKeyPairSync } from 'node:crypto';
import {
  createAccessTensor, evaluateAccessTensor, verifyAccessTensor,
  planRarestFirstChunks, ConnectionTrustSessions,
  createSignedHeartbeat, verifySignedHeartbeat
} from '../src/core/peer-runtime-controls.mjs';

const testCid = value => String(value).padStart(64, '0').slice(-64);

test('access tensor is CID-bound, deny-by-default, and quota bounded', () => {
  const { tensor, cid } = createAccessTensor({
    version: 1,
    rules: [{ app: 'KernelVision', action: 'read', path: 'assets', allow: true }],
    quotas: { KernelVision: { maxConcurrentJobs: 2 } }
  });
  assert.equal(verifyAccessTensor(tensor, cid), true);
  assert.equal(evaluateAccessTensor(tensor, { app: 'KernelVision', action: 'read', path: 'assets/abc', expectedCid: cid }).allowed, true);
  assert.equal(evaluateAccessTensor(tensor, { app: 'KernelVision', action: 'write', path: 'assets/abc', expectedCid: cid }).allowed, false);
  assert.equal(evaluateAccessTensor(tensor, { app: 'KernelVision', action: 'read', path: 'assets/abc', usage: { concurrentJobs: 3 }, expectedCid: cid }).reason, 'quota-exceeded');
  assert.equal(verifyAccessTensor(tensor, testCid('1')), false);
});

test('rarest-first planning ranks scarce CIDs and does not mix app advertisements', () => {
  const rare = testCid('1'), common = testCid('2'), absent = testCid('3');
  const ads = [
    { kind: 'apex.peer-capabilities.v1', payload: { app: 'KernelVision', peerId: 'peer-a', cids: [rare, common] } },
    { kind: 'apex.peer-capabilities.v1', payload: { app: 'KernelVision', peerId: 'peer-b', cids: [common] } },
    { kind: 'apex.peer-capabilities.v1', payload: { app: 'XShield', peerId: 'peer-c', cids: [absent] } }
  ];
  const plan = planRarestFirstChunks([{ hash: common }, { hash: absent }, { hash: rare }], ads, { app: 'KernelVision' });
  assert.deepEqual(plan.map(item => item.cid), [absent, rare, common]);
  assert.equal(plan[0].availablePeerCount, 0);
  assert.deepEqual(plan[1].sourcePeers, ['peer-a']);
  assert.deepEqual(plan[2].sourcePeers, ['peer-a', 'peer-b']);
});

test('connection trust elevation consumes a challenge and revokes on close or credential rotation', async () => {
  const trust = new ConnectionTrustSessions();
  const connection = { closed: false, listeners: new Map(), once(event, callback) { this.listeners.set(event, callback); } };
  const fingerprint = 'credential-fingerprint-v1';
  const challenge = trust.createChallenge(connection, fingerprint);
  const attestation = { challenge, hardwareRootCid: testCid('9'), createdAt: Date.now() };
  await trust.elevate(connection, {
    credentialFingerprint: fingerprint, attestation,
    verifyCredential: async (_connection, input) => input.credentialFingerprint === fingerprint,
    verifyAttestation: async (proof, _connection, context) => proof.challenge === context.challenge
  });
  assert.equal(trust.isElevated(connection, fingerprint), true);
  assert.equal(trust.isElevated(connection, 'credential-rotated'), false);
  connection.listeners.get('close')();
  assert.equal(trust.isElevated(connection, fingerprint), false);
  await assert.rejects(trust.elevate(connection, {
    credentialFingerprint: fingerprint, attestation,
    verifyCredential: async () => true, verifyAttestation: async () => true
  }), /failed closed/);
});

test('signed heartbeat requires the expected peer and hardware-root verifier', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const heartbeat = createSignedHeartbeat({ peerId: 'peer-a', hardwareRootCid: testCid('7'), privateKey });
  const verifyHardwareRoot = async ({ peerId, hardwareRootCid }) => peerId === 'peer-a' && hardwareRootCid === testCid('7');
  assert.equal(await verifySignedHeartbeat(heartbeat, { publicKey, expectedPeerId: 'peer-a', verifyHardwareRoot }), true);
  assert.equal(await verifySignedHeartbeat(heartbeat, { publicKey, expectedPeerId: 'peer-b', verifyHardwareRoot }), false);
  assert.equal(await verifySignedHeartbeat(heartbeat, { publicKey, expectedPeerId: 'peer-a' }), false);
});


test('API client refuses incomplete peer receipt evidence and does not publish an asset manifest', async () => {
  const tokens = Object.fromEntries(APEX_APPS.map(app => [app, 'test-token-' + app + '-' + randomUUID().repeat(2)]));
  const socketPath = '/tmp/apex-storage-receipt-deny-test-' + randomUUID() + '.sock';
  const stores = Object.fromEntries(APEX_APPS.map(app => [app, fakeStore(app)]));
  const originalPutBlob = stores.KernelVision.objects.putBlob.bind(stores.KernelVision.objects);
  stores.KernelVision.objects.putBlob = async bytes => {
    const result = await originalPutBlob(bytes);
    return { ...result, receipts: [] };
  };
  const bridge = createPeerStorageApiBridge({
    stores, tokens, socketPath,
    authorize: async ({ app, operation }) => {
      if (!APEX_APPS.includes(app) || !['readRef', 'writeRef', 'listRefs', 'deleteRef', 'putBlob', 'getBlob'].includes(operation)) {
        throw Object.assign(new Error('test tensor denied operation'), { code: 'ACCESS_DENIED' });
      }
      return { allowed: true, testPolicy: true };
    }
  });
  const previousApp = process.env.APEX_APP_NAMESPACE;
  try {
    await bridge.listen();
    process.env.APEX_APP_NAMESPACE = 'KernelVision';
    const client = new PeerStorageApiClient({ token: tokens.KernelVision, socketPath, chunkSize: 8 * 1024 });
    await assert.rejects(client.putBlob(Buffer.from('receipt evidence must be complete')),
      /complete namespace-bound replica receipt evidence/);
    assert.deepEqual(await client.listRefs('asset-manifests'), [],
      'a rejected write must not publish a readable manifest');
  } finally {
    if (previousApp === undefined) delete process.env.APEX_APP_NAMESPACE;
    else process.env.APEX_APP_NAMESPACE = previousApp;
    await bridge.close();
    await rm(socketPath, { force: true }).catch(() => {});
  }
});


test('peer bridge preserves the fail-closed BFT consensus blocker for API callers', async () => {
  const tokens = Object.fromEntries(APEX_APPS.map(app => [app, 'test-token-' + app + '-' + randomUUID().repeat(2)]));
  const socketPath = '/tmp/apex-storage-bft-gate-' + randomUUID() + '.sock';
  const stores = Object.fromEntries(APEX_APPS.map(app => [app, fakeStore(app)]));
  stores.KernelVision.cas.writeRef = async () => {
    throw Object.assign(new Error('BFT commit provider unavailable'), { code: 'BFT_CONSENSUS_UNAVAILABLE' });
  };
  const bridge = createPeerStorageApiBridge({
    stores, tokens, socketPath,
    authorize: async () => ({ allowed: true })
  });
  const previousApp = process.env.APEX_APP_NAMESPACE;
  try {
    await bridge.listen();
    process.env.APEX_APP_NAMESPACE = 'KernelVision';
    const client = new PeerStorageApiClient({ token: tokens.KernelVision, socketPath });
    await assert.rejects(client.writeRef('state', 'must-not-write', { marker: true }, { expectedHash: null }),
      error => error.code === 'BFT_CONSENSUS_UNAVAILABLE');
  } finally {
    if (previousApp === undefined) delete process.env.APEX_APP_NAMESPACE; else process.env.APEX_APP_NAMESPACE = previousApp;
    await bridge.close();
    await rm(socketPath, { force: true }).catch(() => {});
  }
});
