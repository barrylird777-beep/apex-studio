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
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiresAtMs) || expiresAtMs <= createdAtMs || expiresAtMs - createdAtMs > 30 * 24 * 60 * 60 * 1000) {
    throw new TypeError('proposal validity interval is invalid or exceeds 30 days');
  }
  const payloadBytes = canonical(input.payload);
  if (payloadBytes.byteLength > 1024 * 1024) throw new RangeError('governance payload exceeds 1 MiB');
  const payloadDigest = sha256(payloadBytes);
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
  if (!isRecord(payload) || payload.schemaVersion !== 'apex.governance.proposal.v1' ||
      !isRecord(payload.payload) || !HASH.test(String(payload.payloadDigest || '')) ||
      sha256(canonical(payload.payload)) !== payload.payloadDigest ||
      !HASH.test(String(digest || '')) || sha256(canonical(payload)) !== digest) {
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
  if (!isRecord(policy) || !Array.isArray(policy.members) || policy.members.length > 10000) throw new TypeError('governance policy and a bounded member list are required');
  if (!Number.isFinite(now)) throw new TypeError('governance verification time must be finite');
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
  const allMembers = new Map();
  for (const member of policy.members) {
    if (!isRecord(member) || !member.id) continue;
    const id = String(member.id);
    if (allMembers.has(id)) throw new TypeError('governance member IDs must be unique');
    allMembers.set(id, member);
  }
  const members = new Map([...allMembers].filter(([, member]) =>
    member.revoked !== true && member.status !== 'revoked'
  ).map(([id, member]) => [id, member.publicKey]));
  if (threshold > members.size) throw new Error('governance threshold exceeds active membership');
  if (!Array.isArray(approvals) || approvals.length > 10000) throw new TypeError('governance approvals must be a bounded array');
  const accepted = new Set();
  for (const approval of approvals) {
    if (!isRecord(approval) || typeof approval.signerId !== 'string' || approval.signerId.length > 256 || typeof approval.signature !== 'string' || approval.signature.length > 512) continue;
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
