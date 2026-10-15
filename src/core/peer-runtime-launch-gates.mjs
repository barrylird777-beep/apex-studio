/**
 * APEX peer-runtime launch gate metadata.
 * Primitive availability is not production evidence. A gate only clears when
 * the current release supplies its required live-test evidence.
 */
export const PEER_RUNTIME_LAUNCH_GATES = Object.freeze({
  contentAddressedEncryptedCas: 'implemented-unit-tested',
  atomicReferenceCas: 'implemented-unit-tested',
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
export function evaluatePeerRuntimeLaunchReadiness(evidence = {}) {
  const missing = PEER_RUNTIME_REQUIRED_EVIDENCE.filter(key => evidence[key] !== true);
  return Object.freeze({
    ready: missing.length === 0,
    missing: Object.freeze(missing),
    reason: missing.length ? 'launch blocked: required current-head evidence is missing' : 'required launch evidence supplied'
  });
}
