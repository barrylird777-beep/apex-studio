import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  createAccessTensor, evaluateAccessTensor, verifyAccessTensor, mintCapability, verifyCapability,
  createSignedHeartbeat, verifySignedHeartbeat, createCapabilityAdvertisement,
  verifyCapabilityAdvertisement, ConnectionTrustSessions, publishAccessTensor, planRarestFirstChunks, CapabilityReplayGuard
} from '../src/core/peer-runtime-controls.mjs';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const root = 'a'.repeat(64);

test('access tensors default deny, enforce path specificity, and apply per-app quotas', () => {
  const { tensor, cid } = createAccessTensor({
    rules: [
      { app: 'KernelVision', action: 'read', path: 'assets', allow: true },
      { app: 'KernelVision', action: 'read', path: 'assets/private', allow: false }
    ],
    quotas: { KernelVision: { maxConcurrentJobs: 2 } }
  });
  assert.match(cid, /^[a-f0-9]{64}$/);\n  assert.equal(verifyAccessTensor(tensor, cid), true);\n  assert.equal(evaluateAccessTensor(tensor, { app: 'KernelVision', action: 'read', path: 'assets/clip', expectedCid: '0'.repeat(64) }).allowed, false);
  assert.equal(evaluateAccessTensor(tensor, { app: 'KernelVision', action: 'read', path: 'assets/clip' }).allowed, true);
  assert.equal(evaluateAccessTensor(tensor, { app: 'KernelVision', action: 'read', path: 'assets/private/clip' }).allowed, false);
  assert.equal(evaluateAccessTensor(tensor, { app: 'XShield', action: 'read', path: 'assets/clip' }).allowed, false);
  assert.equal(evaluateAccessTensor(tensor, { app: 'KernelVision', action: 'read', path: 'assets/clip', usage: { concurrentJobs: 3 } }).reason, 'quota-exceeded');
});

test('cross-app capability is signed, short-lived, scoped, replay-protected, and revocable', () => {
  const capability = mintCapability({
    issuerApp: 'PlanetApeX', subjectApp: 'KernelVision', path: 'bible/manuscripts',
    actions: ['read'], expiresAt: Date.now() + 60000, privateKey, nonce: 'test-nonce'
  });
  const replayGuard = new CapabilityReplayGuard();
  const request = { publicKey, subjectApp: 'KernelVision', action: 'read',
    path: 'bible/manuscripts/folio-1', requestId: 'request-0001', replayGuard };
  assert.equal(verifyCapability(capability, request), true);
  assert.equal(verifyCapability(capability, request), false, 'a request identifier cannot be replayed');
  assert.equal(verifyCapability(capability, { ...request, requestId: 'request-0002', subjectApp: 'XShield' }), false);
  assert.equal(verifyCapability(capability, { ...request, requestId: 'request-0003', action: 'write' }), false);
  assert.equal(verifyCapability(capability, { ...request, requestId: 'request-0004',
    isRevoked: nonce => nonce === 'test-nonce' }), false);
  assert.throws(() => mintCapability({
    issuerApp: 'PlanetApeX', subjectApp: 'KernelVision', path: 'bible/manuscripts',
    actions: ['read'], expiresAt: Date.now() + 6 * 60 * 1000, privateKey
  }), /overlong/);
});

test('signed heartbeats and capability advertisements require verified hardware roots', async () => {
  const heartbeat = createSignedHeartbeat({ peerId: 'peer-1', hardwareRootCid: root, privateKey });
  assert.equal(await verifySignedHeartbeat(heartbeat, { publicKey, expectedPeerId: 'peer-1', verifyHardwareRoot: async evidence => evidence.hardwareRootCid === root }), true);
  assert.equal(await verifySignedHeartbeat(heartbeat, { publicKey, expectedPeerId: 'peer-2', verifyHardwareRoot: async () => true }), false);
  assert.equal(await verifySignedHeartbeat(heartbeat, { publicKey, expectedPeerId: 'peer-1' }), false, 'missing hardware-root verifier fails closed');
  const advertisement = createCapabilityAdvertisement({ peerId: 'peer-1', app: 'KernelVision', hardwareRootCid: root, cids: [root], privateKey });
  assert.equal(await verifyCapabilityAdvertisement(advertisement, { publicKey, expectedPeerId: 'peer-1', app: 'KernelVision', verifyHardwareRoot: async evidence => evidence.hardwareRootCid === root }), true);
  assert.equal(await verifyCapabilityAdvertisement(advertisement, { publicKey, expectedPeerId: 'peer-1', app: 'XShield', verifyHardwareRoot: async () => true }), false);
});

test('connection elevation is bound to a live connection and credential fingerprint', async () => {
  const sessions = new ConnectionTrustSessions();
  const connection = { closed: false };
  await sessions.elevate(connection, {
    credentialFingerprint: 'credential-v1', attestation: { challenge: 'fresh' },
    verifyCredential: async () => true, verifyAttestation: async () => true
  });
  assert.equal(sessions.isElevated(connection, 'credential-v1'), true);
  assert.equal(sessions.isElevated(connection, 'credential-v2'), false);
  sessions.revoke(connection);
  assert.equal(sessions.isElevated(connection, 'credential-v1'), false);
});

test('tensor pointer is swapped only after a replicated immutable object is stored', async () => {
  const writes = [];
  const cas = {
    namespace: 'KernelVision', replicaCount: 2,
    async putObject() { return { hash: 'b'.repeat(64), receipts: [
      { peerId: 'p1', hash: 'b'.repeat(64), namespace: 'KernelVision', receiptId: 'r1', durabilityReceipt: { signed: true } },
      { peerId: 'p2', hash: 'b'.repeat(64), namespace: 'KernelVision', receiptId: 'r2', durabilityReceipt: { signed: true } }
    ] }; },
    async writeRef(key, value, options) { writes.push({ key, value, options }); return { hash: 'c'.repeat(64) }; }
  };
  const result = await publishAccessTensor({
    cas, tensor: { rules: [{ app: 'KernelVision', action: 'read', path: 'assets', allow: true }] },
    expectedHash: null
  });
  assert.equal(result.cid, 'b'.repeat(64));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].value.cid, 'b'.repeat(64));
  assert.equal(writes[0].options.expectedHash, null);
});

test('rarest-first planner orders scarce chunks before common chunks and lists verified sources', () => {
  const rare = 'b'.repeat(64), common = 'c'.repeat(64);
  const ads = [
    createCapabilityAdvertisement({ peerId: 'peer-1', app: 'KernelVision', hardwareRootCid: root, cids: [rare, common], privateKey }),
    createCapabilityAdvertisement({ peerId: 'peer-2', app: 'KernelVision', hardwareRootCid: root, cids: [common], privateKey }),
    createCapabilityAdvertisement({ peerId: 'peer-3', app: 'XShield', hardwareRootCid: root, cids: [rare], privateKey })
  ];
  const plan = planRarestFirstChunks([{ hash: common }, { hash: rare }], ads, { app: 'KernelVision' });
  assert.equal(plan[0].cid, rare);
  assert.equal(plan[0].availablePeerCount, 1);
  assert.deepEqual(plan[0].sourcePeers, ['peer-1']);
  assert.equal(plan[1].cid, common);
  assert.equal(plan[1].availablePeerCount, 2);
});
