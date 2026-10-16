import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeCanonical } from '../src/core/apex-cbor.mjs';
import { RemoteBinaryContentAddressedStore } from '../src/core/remote-binary-content-addressed-store.mjs';

function makeStore(manifest) {
  const bytes = encodeCanonical(manifest);
  const client = {
    async send() {
      return {
        Body: { async transformToByteArray() { return bytes; } },
        ETag: '"manifest-etag"'
      };
    }
  };
  return new RemoteBinaryContentAddressedStore({
    endpoint: 'https://objects.example.test',
    bucket: 'test-bucket',
    accessKeyId: 'test-access-key',
    secretAccessKey: 'test-secret-key',
    client
  });
}

test('remote binary CAS rejects a manifest bound to a different namespace', async () => {
  const store = makeStore({
    version: 2,
    namespace: 'other-app',
    key: 'record-1',
    hash: 'a'.repeat(64),
    updatedAt: '2026-01-01T00:00:00.000Z'
  });

  await assert.rejects(
    store.readManifest('expected-app', 'record-1'),
    /manifest namespace or key does not match requested reference/
  );
});

test('remote binary CAS rejects a manifest bound to a different key', async () => {
  const store = makeStore({
    version: 2,
    namespace: 'expected-app',
    key: 'other-record',
    hash: 'b'.repeat(64),
    updatedAt: '2026-01-01T00:00:00.000Z'
  });

  await assert.rejects(
    store.readManifest('expected-app', 'record-1'),
    /manifest namespace or key does not match requested reference/
  );
});

test('remote binary CAS accepts a manifest bound to the requested reference', async () => {
  const store = makeStore({
    version: 2,
    namespace: 'expected-app',
    key: 'record-1',
    hash: 'c'.repeat(64),
    updatedAt: '2026-01-01T00:00:00.000Z'
  });

  const manifest = await store.readManifest('expected-app', 'record-1');
  assert.equal(manifest.namespace, 'expected-app');
  assert.equal(manifest.key, 'record-1');
  assert.equal(manifest.etag, 'manifest-etag');
});
