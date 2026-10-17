import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createGovernanceProposal, signGovernanceApproval, verifyThresholdGovernance } from '../src/security/threshold-governance.mjs';

const makeFixture = () => {
  const keys = Array.from({ length: 4 }, () => generateKeyPairSync('ed25519'));
  const proposal = createGovernanceProposal({
    proposalId: 'proposal-release-rollback-1',
    action: 'release.rollback',
    epoch: 7,
    createdAt: '2026-10-17T00:00:00.000Z',
    expiresAt: '2026-10-18T00:00:00.000Z',
    payload: { activeManifestHash: 'a'.repeat(64), targetManifestHash: 'b'.repeat(64), reason: 'Verified release regression' }
  });
  const approvals = keys.slice(0, 3).map((key, index) => signGovernanceApproval(proposal, 'governor-' + index, key.privateKey));
  const policy = { epoch: 7, threshold: 3, members: keys.map((key, index) => ({ id: 'governor-' + index, publicKey: key.publicKey })) };
  return { keys, proposal, approvals, policy };
};

test('threshold governance verifies distinct Ed25519 approvals for the current epoch', () => {
  const { proposal, approvals, policy } = makeFixture();
  const result = verifyThresholdGovernance({ proposal, approvals }, policy, { now: Date.parse('2026-10-17T01:00:00.000Z') });
  assert.equal(result.verified, true);
  assert.equal(result.threshold, 3);
  assert.equal(result.approvalCount, 3);
  assert.deepEqual(result.signers, ['governor-0', 'governor-1', 'governor-2']);
});

test('threshold governance rejects insufficient, duplicated, revoked, and stale approvals', () => {
  const { proposal, approvals, policy } = makeFixture();
  const now = Date.parse('2026-10-17T01:00:00.000Z');
  assert.throws(() => verifyThresholdGovernance({ proposal, approvals: approvals.slice(0, 2) }, policy, { now }), /threshold not met/);
  assert.throws(() => verifyThresholdGovernance({ proposal, approvals: [approvals[0], approvals[0], approvals[1]] }, policy, { now }), /threshold not met/);
  const revokedPolicy = { ...policy, members: policy.members.map(member => member.id === 'governor-0' ? { ...member, revoked: true } : member) };
  assert.throws(() => verifyThresholdGovernance({ proposal, approvals }, revokedPolicy, { now }), /threshold not met/);
  assert.throws(() => verifyThresholdGovernance({ proposal, approvals }, { ...policy, epoch: 8 }, { now }), /epoch is stale/);
  assert.throws(() => verifyThresholdGovernance({ proposal, approvals }, policy, { now: Date.parse('2026-10-19T00:00:00.000Z') }), /expired or not yet valid/);
});

test('threshold governance rejects tampered proposals, duplicate members, and oversized validity windows', () => {
  const { proposal, approvals, policy } = makeFixture();
  assert.throws(() => verifyThresholdGovernance({ proposal: { ...proposal, payload: { changed: true } }, approvals }, policy, { now: Date.parse('2026-10-17T01:00:00.000Z') }), /digest verification failed/);
  assert.throws(() => verifyThresholdGovernance({ proposal, approvals }, { ...policy, members: [...policy.members, policy.members[0]] }, { now: Date.parse('2026-10-17T01:00:00.000Z') }), /IDs must be unique/);
  assert.throws(() => createGovernanceProposal({
    proposalId: 'proposal-too-long',
    action: 'release.rollback',
    epoch: 7,
    createdAt: '2026-10-17T00:00:00.000Z',
    expiresAt: '2027-01-01T00:00:00.000Z',
    payload: { reason: 'long validity window' }
  }), /exceeds 30 days/);
  assert.throws(() => createGovernanceProposal({
    proposalId: 'proposal-large',
    action: 'release.rollback',
    epoch: 7,
    createdAt: '2026-10-17T00:00:00.000Z',
    expiresAt: '2026-10-18T00:00:00.000Z',
    payload: { note: 'x'.repeat(1024 * 1024) }
  }), /exceeds 1 MiB/);
});
