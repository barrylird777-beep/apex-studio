import test from 'node:test';
import assert from 'node:assert/strict';
import { PeerContentAddressedStore } from '../src/core/peer-content-addressed-store.mjs';

const peers = ['peer-a', 'peer-b'];
const domains = { 'peer-a': 'rack-a', 'peer-b': 'rack-b' };

function makeStore({ certificateValid = true, receiptCount = 2 } = {}) {
  let capturedClaims;
  const verifyDurabilityReceipt = async (receipt, claims) =>
    receipt === 'signed:' + claims.peerId &&
    claims.namespace === 'PlanetApeX' &&
    claims.hash !== null &&
    Number.isSafeInteger(claims.bytes) &&
    claims.receiptId === 'receipt:' + claims.peerId;
  const store = new PeerContentAddressedStore({
    transport: { request: async () => { throw new Error('BFT mode must not use sequential peer CAS'); } },
    peers,
    replicaCount: 2,
    minFailureDomains: 2,
    failureDomainsByPeerId: domains,
    namespace: 'PlanetApeX',
    encryptionKey: Buffer.alloc(32, 7),
    verifyDurabilityReceipt,
    requireBftConsensus: true,
    membershipEpoch: 7,
    commitReference: async proposal => {
      capturedClaims = proposal;
      const receipts = peers.slice(0, receiptCount).map(peerId => ({
        peerId, namespace: proposal.namespace, hash: proposal.hash, bytes: proposal.bytes,
        durable: true, ownership: 'peer-owned', recoveryVerified: true,
        restartRecoveryVerified: true, atomicReferencesVerified: true,
        receipt: 'signed:' + peerId, receiptId: 'receipt:' + peerId
      }));
      return {
        committed: true, operationId: proposal.operationId,
        membershipEpoch: proposal.membershipEpoch, namespace: proposal.namespace,
        key: proposal.key, expectedHash: proposal.expectedHash, hash: proposal.hash,
        certificate: { valid: certificateValid, operationId: proposal.operationId },
        receipts
      };
    },
    verifyCommitCertificate: async (certificate, claims) =>
      certificateValid === true &&
      certificate?.valid === true &&
      certificate.operationId === claims.operationId &&
      claims.protocol === 'apex.cas.commit.v1' &&
      claims.membershipEpoch === 7
  });
  return { store, getClaims: () => capturedClaims };
}

test('BFT reference commit binds certificate to the exact operation and membership epoch', async () => {
  const { store, getClaims } = makeStore();
  const result = await store.writeRef('project-1', { app: 'PlanetApeX', version: 1 });
  assert.match(result.hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.replicas.sort(), peers);
  assert.equal(result.consensus.operationId, getClaims().operationId);
  assert.equal(getClaims().membershipEpoch, 7);
  assert.equal(getClaims().namespace, 'PlanetApeX');
});

test('BFT reference commit fails closed when its certificate is invalid', async () => {
  const { store } = makeStore({ certificateValid: false });
  await assert.rejects(
    store.writeRef('project-1', { app: 'PlanetApeX', version: 1 }),
    error => error.code === 'BFT_COMMIT_UNVERIFIED'
  );
});

test('BFT reference commit fails closed without enough independently verified receipts', async () => {
  const { store } = makeStore({ receiptCount: 1 });
  await assert.rejects(
    store.writeRef('project-1', { app: 'PlanetApeX', version: 1 }),
    error => error.code === 'INSUFFICIENT_REPLICAS' &&
      error.requiredReplicas === 2 &&
      error.verifiedReplicas === 1
  );
});
