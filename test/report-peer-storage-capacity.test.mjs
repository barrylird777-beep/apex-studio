import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const script = path.resolve('scripts/report-peer-storage-capacity.mjs');

test('capacity report CLI measures an explicitly configured peer root', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'apex-capacity-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { stdout } = await execFileAsync(process.execPath, [script], {
    env: {
      ...process.env,
      APEX_SOVEREIGN_PEER_ID: 'peer-cli-test',
      APEX_PEER_FAILURE_DOMAIN: 'host-cli-test',
      APEX_PEER_OWNED_STORAGE_ROOT: root,
      APEX_PEER_STORAGE_RESERVED_BYTES: '4096',
      APEX_PEER_STORAGE_CAPACITY_TTL_MS: '5000'
    }
  });
  const report = JSON.parse(stdout);
  assert.equal(report.peerId, 'peer-cli-test');
  assert.equal(report.failureDomain, 'host-cli-test');
  assert.equal(report.root, root);
  assert.equal(report.reservedBytes, 4096);
  assert.equal(report.expiresAt - report.measuredAt, 5000);
  assert.equal(report.capacitySource, 'filesystem-statfs');
  assert.equal(report.attestationStatus, 'MEASURED_UNAUTHENTICATED');
});

test('capacity report CLI refuses to guess identity or storage root', async () => {
  await assert.rejects(execFileAsync(process.execPath, [script], {
    env: {
      ...process.env,
      APEX_SOVEREIGN_PEER_ID: '',
      APEX_PEER_FAILURE_DOMAIN: '',
      APEX_PEER_OWNED_STORAGE_ROOT: ''
    }
  }), /APEX_SOVEREIGN_PEER_ID is required/);
});
