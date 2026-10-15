import test from 'node:test';
import assert from 'node:assert/strict';
import { startPeerCasRuntime, attestConfiguredPeerRoots } from '../src/core/peer-cas-runtime.mjs';

const ENV_KEYS = [
  'APEX_PEER_CAS_NAMESPACE',
  'APEX_PEER_CAS_ENCRYPTION_KEY_BASE64',
  'APEX_PEER_CAS_ENCRYPTION_KEY_BASE64_KERNELVISION',
  'APEX_PEER_CAS_PEERS',
  'APEX_PEER_CAS_ALLOWED_MODELS',
  'APEX_PEER_CAS_TOKEN'
];

test('Peer-CAS runtime fails closed when required live peer configuration is absent', async () => {
  const previous = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  try {
    for (const key of ENV_KEYS) delete process.env[key];
    await assert.rejects(
      startPeerCasRuntime({ peerNode: { dialProtocol() {} } }),
      /APEX_PEER_CAS_NAMESPACE is required/
    );
  } finally {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('Peer-CAS runtime rejects non-canonical app namespaces before dialing peers', async () => {
  const previous = process.env.APEX_PEER_CAS_NAMESPACE;
  try {
    process.env.APEX_PEER_CAS_NAMESPACE = 'KoBlocks';
    await assert.rejects(
      startPeerCasRuntime({ peerNode: { dialProtocol() {} } }),
      /one canonical app/
    );
  } finally {
    if (previous === undefined) delete process.env.APEX_PEER_CAS_NAMESPACE;
    else process.env.APEX_PEER_CAS_NAMESPACE = previous;
  }
});


test('hardware-root admission binds fresh challenges and failure domains to verified roots', async () => {
  const provider = {
    async attestPeerHardwareRoot({ peerId, app, challenge, issuedAt }) {
      return { peerId, app, challenge, hardwareRootCid: (peerId === 'peer-a' ? 'a' : 'b').repeat(64),
        issuedAt, expiresAt: issuedAt + 30000, signature: 'platform-signed-evidence' };
    },
    async verifyHardwareRoot(evidence, context) {
      return evidence.challenge === context.challenge && evidence.peerId === context.peerId &&
        evidence.app === context.app && evidence.signature === 'platform-signed-evidence';
    },
    async getHardwareFailureDomain(evidence) { return evidence.hardwareRootCid; },
    async getPeerAdvertisements() { return []; },
    async getPeerPublicKey() { return null; }
  };
  const domains = await attestConfiguredPeerRoots({
    peers: ['peer-a', 'peer-b'], namespace: 'KernelVision', provider
  });
  assert.equal(domains['peer-a'], 'hardware-root:' + 'a'.repeat(64));
  assert.equal(domains['peer-b'], 'hardware-root:' + 'b'.repeat(64));
  await assert.rejects(attestConfiguredPeerRoots({
    peers: ['peer-a'], namespace: 'KernelVision',
    provider: { ...provider, async verifyHardwareRoot() { return false; } }
  }), /hardware-root attestation is invalid/);
});

