import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { readFile, realpath, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { signReleaseManifest, verifyReleaseManifest, signRollbackAuthorization, verifyRollbackAuthorization } from '../src/security/content-addressed-release.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const insideRoot = (root, file) => {
  const relativePath = path.relative(root, file);
  return relativePath !== '' && relativePath !== '..' && !relativePath.startsWith('..' + path.sep) && !path.isAbsolute(relativePath);
};
const resolveInsideRoot = (root, relativePath) => {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath) ||
      relativePath.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) {
    throw new TypeError('path must be a safe relative path inside the release root');
  }
  const resolved = path.resolve(root, relativePath);
  if (!insideRoot(root, resolved)) throw new Error('path resolves outside the release root');
  return resolved;
};
const keyFromEnv = (name, create) => {
  const pem = process.env[name];
  if (!pem) throw new Error(name + ' is required');
  return create(Buffer.from(pem.replace(/\\n/g, '\n')));
};

async function readArtifact(root, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath) ||
      relativePath.includes('\\') || relativePath.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new TypeError('unsafe artifact path: ' + String(relativePath));
  }
  const absolute = path.resolve(root, relativePath);
  const real = await realpath(absolute);
  if (!insideRoot(root, real)) throw new Error('artifact resolves outside the release root');
  const bytes = await readFile(real);
  return { path: relativePath, sha256: sha256(bytes), sizeBytes: bytes.length, bytes };
}

async function signCommand() {
  const root = await realpath(process.cwd());
  const version = String(process.env.APEX_RELEASE_VERSION || '');
  const sequence = Number(process.env.APEX_RELEASE_SEQUENCE);
  const artifactPaths = String(process.env.APEX_RELEASE_ARTIFACTS || '').split(',').map(item => item.trim()).filter(Boolean);
  if (!artifactPaths.length) throw new Error('APEX_RELEASE_ARTIFACTS must list one or more comma-separated relative file paths');
  const artifacts = [];
  for (const artifactPath of artifactPaths) {
    const artifact = await readArtifact(root, artifactPath);
    artifacts.push({ path: artifact.path, sha256: artifact.sha256, sizeBytes: artifact.sizeBytes });
  }
  const privateKey = keyFromEnv('APEX_RELEASE_SIGNING_PRIVATE_KEY_PEM', createPrivateKey);
  const envelope = signReleaseManifest({
    sequence,
    version,
    previousManifestHash: process.env.APEX_RELEASE_PREVIOUS_MANIFEST_HASH || null,
    createdAt: new Date().toISOString(),
    artifacts
  }, privateKey);
  const outputPath = process.env.APEX_RELEASE_MANIFEST_OUT || 'dist/apex-release-manifest.json';
  if (artifactPaths.includes(outputPath)) throw new Error('release manifest output cannot overwrite a signed artifact');
  let output = resolveInsideRoot(root, outputPath);
  await mkdir(path.dirname(output), { recursive: true });
  const realDirectory = await realpath(path.dirname(output));
  if (!insideRoot(root, realDirectory)) throw new Error('release manifest output directory resolves outside the release root');
  output = path.join(realDirectory, path.basename(output));
  await writeFile(output, JSON.stringify(envelope, null, 2) + '\n', { mode: 0o600 });
  process.stdout.write(JSON.stringify({ signed: true, output: path.relative(root, output), digest: envelope.digest, sequence: envelope.payload.sequence, artifactCount: envelope.payload.artifacts.length }) + '\n');
}

async function loadVerifiedManifest(root, relativePath, publicKey) {
  const file = await realpath(resolveInsideRoot(root, relativePath));
  if (!insideRoot(root, file)) throw new Error('release manifest resolves outside the release root');
  const envelope = await readFile(file, 'utf8').then(JSON.parse);
  verifyReleaseManifest(envelope, publicKey, { minimumSequence: 0 });
  return envelope;
}

async function knownManifestEnvelopes(root, publicKey) {
  const paths = String(process.env.APEX_RELEASE_KNOWN_MANIFESTS || '').split(',').map(item => item.trim()).filter(Boolean);
  if (!paths.length) throw new Error('APEX_RELEASE_KNOWN_MANIFESTS must list known signed manifests');
  const envelopes = [];
  for (const manifestPath of paths) envelopes.push(await loadVerifiedManifest(root, manifestPath, publicKey));
  return envelopes;
}

async function rollbackSignCommand() {
  const root = await realpath(process.cwd());
  const publicKey = keyFromEnv('APEX_RELEASE_SIGNING_PUBLIC_KEY_PEM', createPublicKey);
  const privateKey = keyFromEnv('APEX_RELEASE_SIGNING_PRIVATE_KEY_PEM', createPrivateKey);
  const active = await loadVerifiedManifest(root, process.env.APEX_RELEASE_ACTIVE_MANIFEST || 'dist/apex-release-manifest.json', publicKey);
  const targetPath = process.env.APEX_RELEASE_ROLLBACK_TARGET_MANIFEST;
  if (!targetPath) throw new Error('APEX_RELEASE_ROLLBACK_TARGET_MANIFEST is required');
  const target = await loadVerifiedManifest(root, targetPath, publicKey);
  const known = await knownManifestEnvelopes(root, publicKey);
  if (!known.some(item => item.digest === target.digest)) throw new Error('rollback target is not in the verified known-manifest set');
  if (target.digest === active.digest || target.payload.sequence >= active.payload.sequence) {
    throw new Error('rollback target must be a different, earlier signed release');
  }
  const sequence = Number(process.env.APEX_RELEASE_ROLLBACK_SEQUENCE);
  if (!Number.isSafeInteger(sequence) || sequence <= active.payload.sequence) {
    throw new Error('APEX_RELEASE_ROLLBACK_SEQUENCE must advance beyond the active release sequence');
  }
  const envelope = signRollbackAuthorization({
    sequence,
    currentManifestHash: active.digest,
    targetManifestHash: target.digest,
    reason: process.env.APEX_RELEASE_ROLLBACK_REASON || '',
    createdAt: new Date().toISOString()
  }, privateKey);
  const outputPath = process.env.APEX_RELEASE_ROLLBACK_OUT || 'dist/apex-rollback-authorization.json';
  const output = resolveInsideRoot(root, outputPath);
  const protectedPaths = [
    process.env.APEX_RELEASE_ACTIVE_MANIFEST || 'dist/apex-release-manifest.json',
    targetPath,
    ...String(process.env.APEX_RELEASE_KNOWN_MANIFESTS || '').split(',').map(item => item.trim()).filter(Boolean)
  ].map(item => resolveInsideRoot(root, item));
  if (protectedPaths.includes(output)) throw new Error('rollback authorization output cannot overwrite a signed manifest');
  await mkdir(path.dirname(output), { recursive: true });
  const realDirectory = await realpath(path.dirname(output));
  if (!insideRoot(root, realDirectory)) throw new Error('rollback output directory resolves outside the release root');
  const finalPath = path.join(realDirectory, path.basename(output));
  await writeFile(finalPath, JSON.stringify(envelope, null, 2) + '\n', { mode: 0o600 });
  process.stdout.write(JSON.stringify({ signed: true, output: path.relative(root, finalPath), sequence, targetVersion: target.payload.version }) + '\n');
}

async function rollbackVerifyCommand() {
  const root = await realpath(process.cwd());
  const publicKey = keyFromEnv('APEX_RELEASE_SIGNING_PUBLIC_KEY_PEM', createPublicKey);
  const authPath = process.env.APEX_RELEASE_ROLLBACK_AUTHORIZATION || 'dist/apex-rollback-authorization.json';
  const authFile = await realpath(resolveInsideRoot(root, authPath));
  if (!insideRoot(root, authFile)) throw new Error('rollback authorization resolves outside the release root');
  const authorization = await readFile(authFile, 'utf8').then(JSON.parse);
  const active = await loadVerifiedManifest(root, process.env.APEX_RELEASE_ACTIVE_MANIFEST || 'dist/apex-release-manifest.json', publicKey);
  const targetPath = process.env.APEX_RELEASE_ROLLBACK_TARGET_MANIFEST;
  if (!targetPath) throw new Error('APEX_RELEASE_ROLLBACK_TARGET_MANIFEST is required');
  const target = await loadVerifiedManifest(root, targetPath, publicKey);
  const known = await knownManifestEnvelopes(root, publicKey);
  const result = verifyRollbackAuthorization(authorization, publicKey, {
    currentSequence: active.payload.sequence,
    activeManifestHash: active.digest,
    targetManifest: target,
    knownManifestHashes: known.map(item => item.digest)
  });
  process.stdout.write(JSON.stringify(result) + '\n');
}

async function verifyCommand() {
  const root = await realpath(process.cwd());
  const manifestPath = process.argv[3] || process.env.APEX_RELEASE_MANIFEST_IN || 'dist/apex-release-manifest.json';
  const manifestFile = await realpath(resolveInsideRoot(root, manifestPath));
  if (!insideRoot(root, manifestFile)) throw new Error('release manifest resolves outside the release root');
  const manifest = await readFile(manifestFile, 'utf8').then(JSON.parse);
  const publicKey = keyFromEnv('APEX_RELEASE_SIGNING_PUBLIC_KEY_PEM', createPublicKey);
  const minimumSequence = process.env.APEX_RELEASE_MINIMUM_SEQUENCE == null ? 0 : Number(process.env.APEX_RELEASE_MINIMUM_SEQUENCE);
  if (!Number.isSafeInteger(minimumSequence) || minimumSequence < 0) throw new TypeError('APEX_RELEASE_MINIMUM_SEQUENCE must be a nonnegative safe integer');
  const expectedPreviousHash = process.env.APEX_RELEASE_PREVIOUS_MANIFEST_HASH;
  const result = verifyReleaseManifest(manifest, publicKey, {
    minimumSequence,
    ...(expectedPreviousHash === undefined ? {} : { expectedPreviousHash })
  });
  for (const artifact of manifest.payload.artifacts) {
    const actual = await readArtifact(root, artifact.path);
    if (actual.sha256 !== artifact.sha256 || actual.sizeBytes !== artifact.sizeBytes) {
      throw new Error('release artifact digest or size mismatch: ' + artifact.path);
    }
  }
  process.stdout.write(JSON.stringify({ ...result, artifactBytesVerified: true }) + '\n');
}

const command = process.argv[2];
try {
  if (command === 'sign') await signCommand();
  else if (command === 'verify') await verifyCommand();
  else if (command === 'rollback-sign') await rollbackSignCommand();
  else if (command === 'rollback-verify') await rollbackVerifyCommand();
  else throw new Error('usage: node scripts/apex-release-policy.mjs <sign|verify|rollback-sign|rollback-verify> [manifest-path]');
} catch (error) {
  process.stderr.write('APEX release policy failed: ' + String(error?.message || error) + '\n');
  process.exitCode = 1;
}
