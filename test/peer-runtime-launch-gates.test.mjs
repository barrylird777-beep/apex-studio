import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PEER_RUNTIME_LAUNCH_GATES,
  PEER_RUNTIME_REQUIRED_EVIDENCE,
  evaluatePeerRuntimeLaunchReadiness
} from '../src/core/peer-runtime-launch-gates.mjs';

test('peer runtime cannot launch from implementation labels alone', () => {
  const result = evaluatePeerRuntimeLaunchReadiness();
  assert.equal(result.ready, false);
  assert.deepEqual(result.missing, [...PEER_RUNTIME_REQUIRED_EVIDENCE]);
});

test('peer runtime launch requires every current-head evidence gate', () => {
  const evidence = Object.fromEntries(PEER_RUNTIME_REQUIRED_EVIDENCE.map(key => [key, true]));
  assert.equal(evaluatePeerRuntimeLaunchReadiness(evidence).ready, true);
  evidence.hardwareRootAttestationVerified = false;
  const blocked = evaluatePeerRuntimeLaunchReadiness(evidence);
  assert.equal(blocked.ready, false);
  assert.deepEqual(blocked.missing, ['hardwareRootAttestationVerified']);
});

test('hardware attestation and end-to-end recovery remain explicitly unverified', () => {
  assert.equal(PEER_RUNTIME_LAUNCH_GATES.hardwareRootAttestation, 'blocked-no-platform-verifier');
  assert.equal(PEER_RUNTIME_LAUNCH_GATES.sixAppRestartRecovery, 'not-live-verified');
  assert.equal(PEER_RUNTIME_LAUNCH_GATES.peerLossConvergence, 'not-live-verified');
});
