import test from 'node:test';
import { isSovereignRuntimeReady, verifyRemoteWalProbe } from '../src/core/runtime-readiness.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

test('legacy foundation quiesce mode serves health without starting PostgreSQL-backed app code', async (t) => {
  const port = await reservePort();
  const child = spawn(process.execPath, ['scripts/railway-start.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), APEX_QUIESCE_LEGACY_FOUNDATION: 'true' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });

  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise(resolve => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 2000);
      timer.unref();
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill('SIGTERM');
    });
  });

  let response;
  let lastError;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      response = await fetch(`http://127.0.0.1:${port}/health`);
      break;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  assert.ok(response, `health endpoint did not start: ${lastError}`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, mode: 'quiesced', storage: 'content-addressed' });

  const blocked = await fetch(`http://127.0.0.1:${port}/api/anything`);
  assert.equal(blocked.status, 503);
  assert.match(output, /legacy foundation quiesced; no PostgreSQL runtime or migrations/);
  assert.doesNotMatch(output, /running PostgreSQL migrations/);
});


test('sovereign readiness requires fresh lease, peer, dispatch, and verified remote WAL', () => {
  const identity = {
    status: 'online',
    leaseExpiresAt: 5000,
    readiness: {
      storageReady: true,
      peerReady: true,
      remoteWalVerified: true,
      dispatchReady: true,
      remoteWalHash: 'a'.repeat(64)
    }
  };
  assert.equal(isSovereignRuntimeReady(identity, 4000), true);
  assert.equal(isSovereignRuntimeReady(identity, 5000), false);
  assert.equal(isSovereignRuntimeReady({ ...identity, readiness: { ...identity.readiness, peerReady: false } }, 4000), false);
  assert.equal(isSovereignRuntimeReady({ ...identity, readiness: { ...identity.readiness, remoteWalVerified: false } }, 4000), false);
  assert.equal(isSovereignRuntimeReady({ ...identity, status: 'starting' }, 4000), false);
});

test('remote WAL probe requires the exact record to appear in a verified snapshot', () => {
  const record = { seq: 7, hash: 'b'.repeat(64) };
  assert.equal(verifyRemoteWalProbe(record, { sequence: 7, ring: [record] }), true);
  assert.equal(verifyRemoteWalProbe(record, { sequence: 8, ring: [{ seq: 8, hash: 'c'.repeat(64) }] }), false);
  assert.equal(verifyRemoteWalProbe(record, { sequence: 6, ring: [record] }), false);
  assert.equal(verifyRemoteWalProbe({ seq: 0, hash: 'b'.repeat(64) }, { sequence: 7, ring: [record] }), false);
});
