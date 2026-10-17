import { createHash, sign, verify } from 'node:crypto';
import { encodeCanonical } from '../core/apex-cbor.mjs';

const canonical = value => Buffer.from(encodeCanonical(value));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const HASH = /^[a-f0-9]{64}$/;

function normalizeProposal(input = {}) {
  if (!isRecord(input)) throw new TypeError('governance proposal must be an object');
  const proposalId = String(input.proposalId || '').trim();
  const action = String(input.action || '').trim();
  const epoch = Number(input.epoch);
  const createdAtMs = Date.parse(String(input.createdAt || ''));
  const expiresAtMs = Date.parse(String(input.expiresAt || ''));
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(proposalId)) throw new TypeError('proposalId is invalid');
  if (!/^[a-z][a-z0-9.-]{1,95}$/.test(action)) throw new TypeError('governance action is invalid');
  if (!Number.isSafeInteger(epoch) || epoch < 0) throw new TypeError('governance epoch must be a nonnegative safe integer');
  if (!isRecord(input.payload)) throw new TypeError('governance payload must be an object');
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiresAtMs) || expiresAtMs <= createdAtMs) {
    throw new TypeError('proposal validity interval is invalid');
  }
  const payloadDigest = sha256(canonical(input.payload));
  return {
    schemaVersion: 'apex.governance.proposal.v1',
    proposalId,
    action,
    epoch,
    createdAt: new Date(createdAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    payload: input.payload,
    payloadDigest
  };
}

export function createGovernanceProposal(input) {
  const normalized = normalizeProposal(input);
  const digest = sha256(canonical(normalized));
  return Object.freeze({ ...normalized, digest });
}

function verifyProposalDigest(proposal) {
  const { digest, ...payload } = proposal || {};
  if (!isRecord(payload) || !HASH.test(String(digest || '')) || sha256(canonical(payload)) !== digest) {
    throw new Error('governance proposal digest verification failed');
  }
  return digest;
}

export function signGovernanceApproval(proposal, signerId, privateKey) {
  const digest = verifyProposalDigest(proposal);
  const id = String(signerId || '').trim();
  if (!id || id.length > 256) throw new TypeError('governance signer ID is invalid');
  const signature = sign(null, Buffer.from(digest, 'hex'), privateKey).toString('base64');
  return Object.freeze({ signerId: id, signature });
}

export function verifyThresholdGovernance({ proposal, approvals } = {}, policy, { now = Date.now() } = {}) {
  if (!isRecord(policy) || !Array.isArray(policy.members)) throw new TypeError('governance policy and members are required');
  const digest = verifyProposalDigest(proposal);
  const epoch = Number(policy.epoch);
  const threshold = Number(policy.threshold);
  if (!Number.isSafeInteger(epoch) || epoch < 0 || !Number.isSafeInteger(threshold) || threshold < 1) {
    throw new TypeError('governance policy epoch or threshold is invalid');
  }
  if (proposal.epoch !== epoch) throw new Error('governance proposal epoch is stale');
  const createdAt = Date.parse(proposal.createdAt);
  const expiresAt = Date.parse(proposal.expiresAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || createdAt > now + 60_000 || expiresAt <= now) {
    throw new Error('governance proposal is expired or not yet valid');
  }
  const members = new Map();
  for (const member of policy.members) {
    if (!isRecord(member) || !member.id || member.revoked === true || member.status === 'revoked') continue;
    if (members.has(String(member.id))) throw new TypeError('governance member IDs must be unique');
    members.set(String(member.id), member.publicKey);
  }
  if (threshold > members.size) throw new Error('governance threshold exceeds active membership');
  if (!Array.isArray(approvals)) throw new TypeError('governance approvals must be an array');
  const accepted = new Set();
  for (const approval of approvals) {
    if (!isRecord(approval) || typeof approval.signerId !== 'string' || typeof approval.signature !== 'string') continue;
    const signerId = approval.signerId;
    if (accepted.has(signerId) || !members.has(signerId)) continue;
    try {
      if (verify(null, Buffer.from(digest, 'hex'), members.get(signerId), Buffer.from(approval.signature, 'base64'))) {
        accepted.add(signerId);
      }
    } catch {
      // Invalid/unparseable signatures do not count toward threshold.
    }
  }
  if (accepted.size < threshold) throw new Error('governance threshold not met: ' + accepted.size + '/' + threshold);
  return Object.freeze({
    verified: true,
    proposalId: proposal.proposalId,
    action: proposal.action,
    epoch,
    threshold,
    approvalCount: accepted.size,
    signers: Object.freeze([...accepted].sort())
  });
}
