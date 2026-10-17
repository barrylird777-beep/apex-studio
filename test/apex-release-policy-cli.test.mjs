import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
