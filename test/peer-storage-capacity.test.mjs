import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { measurePeerStorageCapacity, validatePeerStorageCapacity } from '../src/core/peer-storage-capacity.mjs';

test('measures actual filesystem capacity and subtracts operator reserve', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'apex-capacity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const report = await measurePeerStorageCapacity({
    peerId: 'peer-test', failureDomain: 'host-test', root,
    reservedBytes: 4096, now: 1000, ttlMs: 5000
  });
  assert.equal(report.peerId, 'peer-test');
  assert.ok(report.totalBytes > 0);
  assert.ok(report.availableBytes > 0);
  assert.equal(report.usableBytes, Math.max(0, report.availableBytes - 4096));
  assert.equal(report.expiresAt, 6000);
  assert.equal(report.attestationStatus, 'MEASURED_UNAUTHENTICATED');
  assert.equal(validatePeerStorageCapacity(report, { now: 2000, maxAgeMs: 5000 }), report.usableBytes > 0);
});

test('fails closed for missing peer-owned root and invalid reserve', async () => {
  await assert.rejects(measurePeerStorageCapacity({
    peerId: 'peer-test', failureDomain: 'host-test', root: ''
  }), /must explicitly name peer-owned capacity/);
  await assert.rejects(measurePeerStorageCapacity({
    peerId: 'peer-test', failureDomain: 'host-test', root: '/tmp', reservedBytes: -1
  }), /non-negative safe integer/);
});

test('capacity claims expire and arithmetic tampering is rejected', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'apex-capacity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const report = await measurePeerStorageCapacity({
    peerId: 'peer-test', failureDomain: 'host-test', root,
    reservedBytes: 1, now: 1000, ttlMs: 1000
  });
  assert.equal(validatePeerStorageCapacity(report, { now: 2000, maxAgeMs: 5000 }), false);
  assert.equal(validatePeerStorageCapacity({ ...report, usableBytes: report.availableBytes }, {
    now: 1500, maxAgeMs: 5000
  }), false);
  assert.equal(validatePeerStorageCapacity({ ...report, totalBytes: 0 }, {
    now: 1500, maxAgeMs: 5000
  }), false);
});


test('authenticated capacity validation binds report to transport identity and trusted failure domain', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'apex-capacity-auth-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const report = await measurePeerStorageCapacity({
    peerId: 'peer-a', failureDomain: 'host-a', root,
    reservedBytes: 0, now: 1000, ttlMs: 5000
  });
  const options = {
    authenticatedPeerId: 'peer-a',
    trustedFailureDomains: { 'peer-a': 'host-a' },
    now: 2000,
    maxAgeMs: 5000
  };
  assert.equal(validateAuthenticatedPeerStorageCapacity(report, options), report.usableBytes > 0);
  assert.equal(validateAuthenticatedPeerStorageCapacity(report, {
    ...options, authenticatedPeerId: 'peer-b'
  }), false, 'a peer cannot advertise another peer identity');
  assert.equal(validateAuthenticatedPeerStorageCapacity(report, {
    ...options, trustedFailureDomains: { 'peer-a': 'host-b' }
  }), false, 'self-claimed failure domains are not trusted');
  assert.equal(validateAuthenticatedPeerStorageCapacity({
    ...report, failureDomain: 'host-b'
  }, options), false, 'reported failure domain must match operator registry');
});
