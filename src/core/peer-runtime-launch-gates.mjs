/**
 * APEX peer-runtime launch gate metadata.
 * Primitive availability is not production evidence. A gate only clears when
 * the current release supplies its required live-test evidence.
 */
export const PEER_RUNTIME_LAUNCH_GATES = Object.freeze({
  contentAddressedEncryptedCas: 'implemented-unit-tested',
  atomicReferenceCas: 'implemented-unit-tested',
  bftCasConsensus: 'blocked-sequential-replica-cas-not-global-atomic',
  perAppCredentialsAndNamespaces: 'implemented-unit-tested',
  verifiedRamCache: 'implemented-unit-tested',
  parallelChunkAssembly: 'implemented-unit-tested',
  rarestFirstFetch: 'implemented-primitive-not-live-wired',
  peerLossRepair: 'implemented-pull-repair-not-live-verified',
  versionedAccessControlCids: 'implemented-primitive-not-enforced-everywhere',
  crossAppCapabilityCids: 'implemented-primitive-not-enforced-everywhere',
  signedHeartbeats: 'implemented-primitive-no-gossip',
  capabilityAdvertisements: 'implemented-primitive-no-live-gossip',
  connectionScopedTrust: 'implemented-primitive-not-transport-wired',
  allRuntimeOperationsTensorGated: 'bridge-gated-direct-runtime-paths-unverified',
  hardwareRootAttestation: 'blocked-no-platform-verifier',
  runtimeQuotas: 'primitive-only-not-runtime-enforced',
  erasureCoding: 'optional-not-implemented',
  speculativePrefetch: 'not-implemented',
  performanceEvidence: 'not-measured',
  sixAppRestartRecovery: 'not-live-verified',
  peerLossConvergence: 'not-live-verified',
  noPersistentWritesAfterRestart: 'not-live-verified'
});

export const PEER_RUNTIME_REQUIRED_EVIDENCE = Object.freeze([
  'hardwareRootAttestationVerified',
  'bftCasSafetyVerified',
  'connectionScopedTrustTransportWired',
  'allRuntimeOperationsTensorGated',
  'allSixAppsIsolationVerified',
  'replicaReceiptsVerified',
  'restartRecoveryVerified',
  'peerLossRepairVerified',
  'noPersistentFallbackVerified',
  'currentHeadCiPassed',
  'adversarialBenchmarksPublished'
]);

/**
 * Evidence must be supplied by release automation from the exact candidate
 * commit. Missing, stale, or false evidence blocks launch.
 */
export function evaluatePeerRuntimeLaunchReadiness(evidence = {}, { expectedCommitSha = '' } = {}) {
  const missing = PEER_RUNTIME_REQUIRED_EVIDENCE.filter(key => evidence[key] !== true);
  const validSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
  if (!validSha(expectedCommitSha) || !validSha(evidence.commitSha) || evidence.commitSha !== expectedCommitSha) {
    missing.unshift('evidenceCommitShaMatchesCandidate');
  }
  return Object.freeze({
    ready: missing.length === 0,
    missing: Object.freeze(missing),
    reason: missing.length ? 'launch blocked: required current-head evidence is missing' : 'required launch evidence supplied'
  });
}
