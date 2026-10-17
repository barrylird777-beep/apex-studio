import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../scripts/apex-release-policy.mjs', import.meta.url));

test('release CLI signs a manifest, verifies artifact bytes, and rejects changed artifacts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'apex-release-policy-'));
  const keys = generateKeyPairSync('ed25519');
  const privatePem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const env = {
    ...process.env,
    APEX_RELEASE_VERSION: '1.0.0',
    APEX_RELEASE_SEQUENCE: '1',
    APEX_RELEASE_ARTIFACTS: 'artifact.txt',
    APEX_RELEASE_MANIFEST_OUT: 'dist/manifest.json',
    APEX_RELEASE_SIGNING_PRIVATE_KEY_PEM: privatePem,
    APEX_RELEASE_SIGNING_PUBLIC_KEY_PEM: publicPem,
    APEX_RELEASE_MINIMUM_SEQUENCE: '0'
  };
  try {
    await writeFile(path.join(root, 'artifact.txt'), 'verified release bytes');
    const signed = spawnSync(process.execPath, [script, 'sign'], { cwd: root, env, encoding: 'utf8' });
    assert.equal(signed.status, 0, signed.stderr);
    const manifest = JSON.parse(await readFile(path.join(root, 'dist/manifest.json'), 'utf8'));
    assert.equal(manifest.payload.artifacts[0].path, 'artifact.txt');
    const verified = spawnSync(process.execPath, [script, 'verify', 'dist/manifest.json'], { cwd: root, env, encoding: 'utf8' });
    assert.equal(verified.status, 0, verified.stderr);
    assert.equal(JSON.parse(verified.stdout).artifactBytesVerified, true);
    await writeFile(path.join(root, 'artifact.txt'), 'changed after signing');
    const changed = spawnSync(process.execPath, [script, 'verify', 'dist/manifest.json'], { cwd: root, env, encoding: 'utf8' });
    assert.notEqual(changed.status, 0);
    assert.match(changed.stderr, /artifact digest or size mismatch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('release CLI signs and verifies a monotonic rollback authorization to a known signed release', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'apex-release-rollback-'));
  const keys = generateKeyPairSync('ed25519');
  const privatePem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const baseEnv = {
    ...process.env,
    APEX_RELEASE_SIGNING_PRIVATE_KEY_PEM: privatePem,
    APEX_RELEASE_SIGNING_PUBLIC_KEY_PEM: publicPem,
    APEX_RELEASE_MINIMUM_SEQUENCE: '0'
  };
  try {
    await writeFile(path.join(root, 'artifact-v1.txt'), 'release one');
    await writeFile(path.join(root, 'artifact-v2.txt'), 'release two');
    const firstSign = spawnSync(process.execPath, [script, 'sign'], {
      cwd: root,
      env: { ...baseEnv, APEX_RELEASE_VERSION: '1.0.0', APEX_RELEASE_SEQUENCE: '1', APEX_RELEASE_ARTIFACTS: 'artifact-v1.txt', APEX_RELEASE_MANIFEST_OUT: 'dist/v1.json', APEX_RELEASE_PREVIOUS_MANIFEST_HASH: '' },
      encoding: 'utf8'
    });
    assert.equal(firstSign.status, 0, firstSign.stderr);
    const first = JSON.parse(await readFile(path.join(root, 'dist/v1.json'), 'utf8'));
    const secondSign = spawnSync(process.execPath, [script, 'sign'], {
      cwd: root,
      env: { ...baseEnv, APEX_RELEASE_VERSION: '1.1.0', APEX_RELEASE_SEQUENCE: '2', APEX_RELEASE_ARTIFACTS: 'artifact-v2.txt', APEX_RELEASE_MANIFEST_OUT: 'dist/v2.json', APEX_RELEASE_PREVIOUS_MANIFEST_HASH: first.digest },
      encoding: 'utf8'
    });
    assert.equal(secondSign.status, 0, secondSign.stderr);
    const second = JSON.parse(await readFile(path.join(root, 'dist/v2.json'), 'utf8'));
    const rollbackEnv = {
      ...baseEnv,
      APEX_RELEASE_ACTIVE_MANIFEST: 'dist/v2.json',
      APEX_RELEASE_ROLLBACK_TARGET_MANIFEST: 'dist/v1.json',
      APEX_RELEASE_KNOWN_MANIFESTS: 'dist/v1.json,dist/v2.json',
      APEX_RELEASE_ROLLBACK_SEQUENCE: '3',
      APEX_RELEASE_ROLLBACK_REASON: 'Rollback due to a verified release regression.',
      APEX_RELEASE_ROLLBACK_OUT: 'dist/rollback.json'
    };
    const signedRollback = spawnSync(process.execPath, [script, 'rollback-sign'], { cwd: root, env: rollbackEnv, encoding: 'utf8' });
    assert.equal(signedRollback.status, 0, signedRollback.stderr);
    const collision = spawnSync(process.execPath, [script, 'rollback-sign'], {
      cwd: root,
      env: { ...rollbackEnv, APEX_RELEASE_ROLLBACK_OUT: 'dist/v1.json' },
      encoding: 'utf8'
    });
    assert.notEqual(collision.status, 0);
    assert.match(collision.stderr, /cannot overwrite a signed manifest/);
    const rollback = JSON.parse(await readFile(path.join(root, 'dist/rollback.json'), 'utf8'));
    assert.equal(rollback.payload.currentManifestHash, second.digest);
    assert.equal(rollback.payload.targetManifestHash, first.digest);
    const verifiedRollback = spawnSync(process.execPath, [script, 'rollback-verify'], {
      cwd: root,
      env: { ...rollbackEnv, APEX_RELEASE_ROLLBACK_AUTHORIZATION: 'dist/rollback.json' },
      encoding: 'utf8'
    });
    assert.equal(verifiedRollback.status, 0, verifiedRollback.stderr);
    assert.equal(JSON.parse(verifiedRollback.stdout).targetVersion, '1.0.0');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('release CLI rejects artifact paths that escape the release root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'apex-release-path-'));
  const keys = generateKeyPairSync('ed25519');
  const privatePem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const env = {
    ...process.env,
    APEX_RELEASE_VERSION: '1.0.0',
    APEX_RELEASE_SEQUENCE: '1',
    APEX_RELEASE_ARTIFACTS: '../outside.txt',
    APEX_RELEASE_SIGNING_PRIVATE_KEY_PEM: privatePem
  };
  try {
    const result = spawnSync(process.execPath, [script, 'sign'], { cwd: root, env, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unsafe artifact path/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
