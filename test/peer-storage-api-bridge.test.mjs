import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import http from 'node:http';
import { createPeerStorageApiBridge, APEX_APPS } from '../src/core/peer-storage-api-bridge.mjs';

function fakeStore(namespace) {
  const refs = new Map();
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
      async putBlob(bytes) { return { hash: randomUUID().replaceAll('-', '').padEnd(64, '0'), bytes: bytes.length }; },
      async getBlob() { return Buffer.from('peer-data'); }
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
  const token = 'test-token-' + randomUUID().repeat(3);
  const socketPath = '/tmp/apex-storage-bridge-test-' + randomUUID() + '.sock';
  const stores = Object.fromEntries(APEX_APPS.map(app => [app, fakeStore(app)]));
  const bridge = createPeerStorageApiBridge({ stores, token, socketPath });
  try {
    await bridge.listen();
    assert.equal((await request(socketPath, 'wrong-token', { app: 'KernelVision', operation: 'listRefs', args: { namespace: 'state' } })).status, 401);
    const write = await request(socketPath, token, { app: 'KernelVision', operation: 'writeRef',
      args: { namespace: 'state', key: 'item-1', value: { marker: 'only-kernelvision' }, expectedHash: null } });
    assert.equal(write.status, 200);
    const own = await request(socketPath, token, { app: 'KernelVision', operation: 'readRef',
      args: { namespace: 'state', key: 'item-1' } });
    assert.equal(own.body.result.value.marker, 'only-kernelvision');
    const other = await request(socketPath, token, { app: 'XShield', operation: 'readRef',
      args: { namespace: 'state', key: 'item-1' } });
    assert.equal(other.body.result, null);
    const invalid = await request(socketPath, token, { app: 'not-an-app', operation: 'listRefs', args: { namespace: 'state' } });
    assert.equal(invalid.status, 403);
  } finally {
    await bridge.close();
    await rm(socketPath, { force: true }).catch(() => {});
  }
});
