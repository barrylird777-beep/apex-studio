import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { signReleaseManifest, verifyReleaseManifest, signRollbackAuthorization, verifyRollbackAuthorization } from '../src/security/content-addressed-release.mjs';

const release = (sequence, version, previousManifestHash = null) => ({
  sequence,
  version,
  previousManifestHash,
  createdAt: '2026-10-17T00:00:00.000Z',
  artifacts: [
    { path: 'public/index.html', sha256: 'a'.repeat(64), sizeBytes: 1200 },
    { path: 'public/assistant-overlay.js', sha256: 'b'.repeat(64), sizeBytes: 800 }
  ]
});

test('signed content-addressed releases verify chain, artifact inventory, and monotonic sequence', () => {
  const keys = generateKeyPairSync('ed25519');
  const first = signReleaseManifest(release(1, '1.0.0'), keys.privateKey);
  const second = signReleaseManifest(release(2, '1.1.0', first.digest), keys.privateKey);
  assert.equal(verifyReleaseManifest(first, keys.publicKey).verified, true);
  assert.equal(verifyReleaseManifest(second, keys.publicKey, { minimumSequence: 1, expectedPreviousHash: first.digest }).version, '1.1.0');
  assert.throws(() => verifyReleaseManifest(second, keys.publicKey, { minimumSequence: 2 }), /sequence is stale/);
  assert.throws(() => verifyReleaseManifest(second, keys.publicKey, { expectedPreviousHash: 'c'.repeat(64) }), /predecessor/);
});

test('release signatures reject payload tampering and unsafe artifact paths', () => {
  const keys = generateKeyPairSync('ed25519');
  const signed = signReleaseManifest(release(1, '1.0.0'), keys.privateKey);
  assert.throws(() => verifyReleaseManifest({ ...signed, payload: { ...signed.payload, version: '9.9.9' } }, keys.publicKey), /signature verification failed/);
  assert.throws(() => signReleaseManifest({ ...release(1, '1.0.0'), artifacts: [{ path: '../secrets', sha256: 'a'.repeat(64), sizeBytes: 1 }] }, keys.privateKey), /path is unsafe/);
  assert.throws(() => signReleaseManifest({ ...release(1, '1.0.0'), artifacts: [release(1, '1.0.0').artifacts[0], release(1, '1.0.0').artifacts[0]] }, keys.privateKey), /paths must be unique/);
});

test('rollback requires a signed higher sequence and a previously known target manifest', () => {
  const keys = generateKeyPairSync('ed25519');
  const first = signReleaseManifest(release(1, '1.0.0'), keys.privateKey);
  const second = signReleaseManifest(release(2, '1.1.0', first.digest), keys.privateKey);
  const rollback = signRollbackAuthorization({
    sequence: 3,
    currentManifestHash: second.digest,
    targetManifestHash: first.digest,
    reason: 'Rollback due to a verified release regression.',
    createdAt: '2026-10-17T01:00:00.000Z'
  }, keys.privateKey);
  const result = verifyRollbackAuthorization(rollback, keys.publicKey, {
    currentSequence: 2,
    activeManifestHash: second.digest,
    targetManifest: first,
    knownManifestHashes: [first.digest]
  });
  assert.equal(result.verified, true);
  assert.equal(result.targetVersion, '1.0.0');
  assert.throws(() => verifyRollbackAuthorization(rollback, keys.publicKey, {
    currentSequence: 3, activeManifestHash: second.digest, targetManifest: first, knownManifestHashes: [first.digest]
  }), /advance monotonically/);
  assert.throws(() => verifyRollbackAuthorization(rollback, keys.publicKey, {
    currentSequence: 2, activeManifestHash: 'c'.repeat(64), targetManifest: first, knownManifestHashes: [first.digest]
  }), /does not match the active manifest/);
  assert.throws(() => verifyRollbackAuthorization(rollback, keys.publicKey, {
    currentSequence: 2, activeManifestHash: second.digest, targetManifest: first, knownManifestHashes: []
  }), /known content-addressed release/);
  const notEarlier = signRollbackAuthorization({
    sequence: 3,
    currentManifestHash: second.digest,
    targetManifestHash: second.digest,
    reason: 'This target is not earlier than the active release.',
    createdAt: '2026-10-17T01:00:00.000Z'
  }, keys.privateKey);
  assert.throws(() => verifyRollbackAuthorization(notEarlier, keys.publicKey, {
    currentSequence: 2, activeManifestHash: second.digest, targetManifest: second, knownManifestHashes: [second.digest]
  }), /target must be an earlier signed release/);
});
