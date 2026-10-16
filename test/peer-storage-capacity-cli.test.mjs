import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const script = path.resolve('scripts/report-peer-storage-capacity.mjs');

test('peer capacity CLI reports measured bytes for an explicitly assigned peer root', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'apex-capacity-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      APEX_PEER_ID: 'peer-cli-test',
      APEX_PEER_FAILURE_DOMAIN: 'host-cli-test',
      APEX_PEER_OWNED_STORAGE_ROOT: root,
      APEX_PEER_STORAGE_RESERVED_BYTES: '4096'
    }
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.peerId, 'peer-cli-test');
  assert.equal(report.failureDomain, 'host-cli-test');
  assert.equal(report.capacitySource, 'filesystem-statfs');
  assert.equal(report.attestationStatus, 'MEASURED_UNAUTHENTICATED');
  assert.equal(report.usableBytes, Math.max(0, report.availableBytes - 4096));
});

test('peer capacity CLI refuses to guess a peer identity, failure domain, or root', () => {
  const env = { ...process.env };
  delete env.APEX_PEER_ID;
  delete env.APEX_PEER_FAILURE_DOMAIN;
  delete env.APEX_PEER_OWNED_STORAGE_ROOT;
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', env });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /explicit peerId is required/);
});
