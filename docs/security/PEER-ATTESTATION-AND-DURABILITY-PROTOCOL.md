# Peer Attestation and Replication Durability Protocol

Status: **binding engineering requirement; implementation not yet proven**

This protocol applies to peer-owned system-of-record storage and security decisions based on a storage node's identity or integrity. An attestation is time-bound evidence, not a permanent guarantee.

## Attestation lifecycle
- Every attestation MUST bind authenticated node identity, a fresh single-use verifier nonce, issuance time, expiry time, measured firmware and security-relevant configuration digests, requested role, and policy version.
- Attestations MUST expire within a policy-bounded lifetime. Missing, expired, malformed, replayed, or unverifiable attestations fail closed for placement, quorum participation, key release, and privileged actions.
- Verifiers MUST check freshness and replay resistance, not signature alone. Cached results must never outlive signed expiry.
- If freshness, clock validity, or revocation status cannot be established, the node is ineligible for trusted operations.

## Firmware and configuration changes
- Any firmware, boot-chain, hypervisor, storage software, security policy, peer identity key, or security-relevant configuration change MUST invalidate prior attestation.
- The changed node MUST be quarantined from placement and quorum participation until fresh attestation of the new measured state passes policy. Rollback also requires fresh attestation.
- Measurements MUST use canonical digests of approved state; self-reported labels or version strings alone are insufficient.
- Unapproved measurements or failed attestation trigger an auditable exclusion and alert.

## Physical compromise and threshold security
- Assume a sufficiently resourced physical adversary who obtains a node may eventually extract secrets or forge evidence for that specific node. Hardware roots of trust raise cost and provide measurements; they do not make a seized node incorruptible.
- No single node, attestation, replica receipt, or administrator-controlled host may independently authorize a global transition or establish durability.
- Sensitive actions require an explicit threshold of independently authenticated nodes across distinct failure domains. Reject missing, duplicate, or unverified failure-domain assignments.
- Count only distinct eligible failure domains. Multiple processes, VMs, containers, or disks controlled by one failure domain are not independent replicas.
- Document the compromise threshold and do not claim protection beyond it.

## Replication-based durability and recovery
- Durability is a property of acknowledged independent replicas and verified recovery, not any one piece of silicon.
- A durable-write receipt MUST bind content hash, namespace, write/version ID, policy version, replica identities, failure-domain identities, and the quorum actually acknowledged.
- A write is durable only after the configured number of eligible replicas across the required distinct failure domains persist data and return authenticated acknowledgements. Local cache or one peer acknowledgement is not quorum.
- Reads and repair verify content hashes and authorization. Peer loss or exclusion triggers alerting and repair from eligible surviving replicas.
- If quorum is unavailable, refuse to report the write as durable. Retry/repair-pending status must be explicit and must not look like a committed durable write.
- Recovery tests stop/restart independent peers, remove a peer, corrupt or withhold a replica, restore service, and verify data plus replica repair. In-memory fixtures do not prove physical durability.

## Detection and exclusion
- Monitor expiry, measurement changes, duplicate/conflicting identities, peer-key changes, nonce failures, inconsistent receipts, replica divergence, and abnormal behavior.
- Exclude suspicious nodes promptly from placement and quorum counts; record evidence, reason, policy version, time, and action.
- Propagate revocation to writers, readers, placement, key release, workers, and repair. Stale caches must not re-admit a node.
- Re-admission requires fresh attestation, identity/key validation, policy approval, and required integrity/replication checks—not mere reconnection.
- Keep audit/alert records protected and outside the sole failure domain of a potentially compromised node.

## Required adversarial tests
1. A correctly signed but expired attestation is rejected.
2. Replayed nonce and stale/mismatched node identity are rejected.
3. Firmware/configuration change invalidates prior attestation and removes the node from quorum until re-attested.
4. Missing, invalid, or revoked attestation cannot receive placements or count toward quorum/receipts.
5. Duplicate failure-domain labels do not inflate replica independence.
6. One compromised node cannot forge a multi-node receipt or alter authoritative metadata alone.
7. Replica loss preserves readable data and triggers repair; quorum loss never produces false durable acknowledgement.
8. Exclusion/re-admission applies across all six app namespaces, shared system namespaces, workers, and repair.
9. Peer restart proves persisted data survives, distinguishing live hosts from simulations.

## Evidence and release gate
For each claim, retain exact commit, test command/output, peer identities, configuration digests, expiry/re-attestation events, failure-domain map, quorum receipts, restart/peer-loss/recovery results, and independent read-back. Track each control as **specified**, **implemented**, **automated-tested**, **live-tested**, or **independently verified**. Never promote a claim without evidence.

This is a binding engineering requirement, not proof that runtime enforcement exists. Do not merge or deploy a release that claims compliance while a required gate remains open.