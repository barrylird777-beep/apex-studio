import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PeerContentAddressedStore } from '../src/core/peer-content-addressed-store.mjs';
import { initializePeerObjectStorage } from '../src/core/peer-storage-runtime.mjs';

test('peer object storage stays disabled unless explicitly enabled', async () => {
  const runtime = await initializePeerObjectStorage({ enabled: false });
  assert.equal(runtime.enabled, false);
  await assert.rejects(runtime.handle({}, { remotePeerId: 'writer-peer' }), /disabled/);
});

test('peer object storage requires an absolute root and canonical explicit namespace ACL', async () => {
  await assert.rejects(
    initializePeerObjectStorage({ enabled: true, root: 'relative/path', namespaceAcl: { PlanetApeX: ['writer-peer'] }, peerId: () => 'storage-peer' }),
    /explicit absolute non-root/
  );
  await assert.rejects(
    initializePeerObjectStorage({ enabled: true, root: path.join(os.tmpdir(), 'apex-peer-acl-invalid'), namespaceAcl: { KoBlocks: ['writer-peer'] }, peerId: () => 'storage-peer' }),
    /non-canonical app/
  );
});

test('opt-in runtime persists only encrypted peer objects and enforces namespace ACL', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'apex-peer-object-store-'));
  try {
    const runtime = await initializePeerObjectStorage({
      enabled: true,
      root,
      namespaceAcl: { PlanetApeX: ['writer-peer'] },
      peerId: () => 'storage-peer'
    });
    const client = new PeerContentAddressedStore({
      transport: { request: async (_peerId, envelope) => runtime.handle(envelope, { remotePeerId: 'writer-peer' }) },
      peers: ['storage-peer'],
      replicaCount: 1,
      failureDomainsByPeerId: { 'storage-peer': 'test-domain-storage-peer' },
      namespace: 'PlanetApeX',
      encryptionKey: Buffer.alloc(32, 23)
    });
    const value = { privateTitle: 'unpublished manuscript', app: 'PlanetApeX' };
    const receipt = await client.putObject(value);
    assert.equal(receipt.replicas[0], 'storage-peer');
    assert.deepEqual(await client.getObject(receipt.hash), value);
    const storedEnvelope = await runtime.store.getObject(receipt.hash);
    assert.equal(storedEnvelope.algorithm, 'aes-256-gcm');
    assert.equal(JSON.stringify(storedEnvelope).includes('unpublished manuscript'), false);
    await assert.rejects(
      runtime.handle({ protocol: 'apex.cas.v1', operation: 'object.get', namespace: 'PlanetApeX', hash: receipt.hash }, { remotePeerId: 'unlisted-peer' }),
      /namespace access denied/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
