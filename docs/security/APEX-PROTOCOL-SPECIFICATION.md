# APEX Protocol Specification — Message Formats, State Machines, Attestation, Recovery

Status: **protocol proposal / implementation not yet proven**  
Scope: peer membership, CAS, attestation, configuration policy, replication, recovery, and key rotation. This specification must be implemented and tested before any compliance claim.

## 0. Normative assumptions and corrections

- Messages are authenticated and encoded canonically (CBOR preferred). Reject non-canonical, oversized, malformed, unknown-critical-field, or downgrade messages.
- **Header-size correction:** the proposed fields version(1)+type(1)+flags(2)+payload_len(4)+sender_cid(32)+nonce(8) total **48 bytes**, not 16. Either adopt this 48-byte fixed header or change the field sizes explicitly. Implementations must not use the contradictory 16-byte claim.
- The transport must authenticate the sender and protect message integrity. The header's sender CID is a claimed identifier, not proof of identity.
- Bind signatures/quotes to a domain-separated digest of protocol version, message type, sender identity, recipient or intended peer set, nonce, payload hash, policy epoch, and operation. Enforce maximum payload length before allocation.
- Use a cryptographically random, single-use challenge nonce; do not rely on an 8-byte nonce alone for globally unique security. Persist replay windows or use a challenge-response session bound to identity and epoch.
- Every message with security effects has an explicit policy/membership epoch and expiry/freshness rule. Reject stale epochs, replayed requests, and unknown critical flags.

## 1. Message schemas

The following are logical schemas; production wire encoding must specify canonical CBOR/binary field IDs, integer widths, limits, versioning, and signature coverage.

### Common envelope
`Envelope { version:u8, msg_type:u8, flags:u16, payload_len:u32, sender_cid:CID32, nonce:bytes, policy_epoch:u64, payload:bytes, auth:SignatureOrMAC }`

The wire header and payload length must be validated before decoding. The sender CID resolves to an identity record; the record and authorization must be verified independently.

### Join
`JoinRequest { node_identity:NodeIdentity, measured_config:MeasuredConfig, quote:AttestationQuote, wanted_replicas:u16, listen_addrs:Multiaddr[], bootstrap_epoch:u64 }`
`JoinResponse { accepted:bool, reason:RejectCode?, signed_peer_snapshot:PeerSnapshot, assigned_shards:ShardID[], challenge:bytes?, policy_epoch:u64, expires_at:u64, responder_auth:Signature }`
`PeerRecord { node_cid:CID32, identity_key:PublicKey, attestation_key:PublicKey, measurement_digest:Hash, quote_digest:Hash, attested_at:u64, expires_at:u64, policy_epoch:u64, failure_domain_proof:FailureDomainEvidence, addrs:Multiaddr[], status:eligible|quarantined|revoked }`

A join response is not authority by itself. Verify a quorum-signed membership snapshot, each included record's freshness/revocation, and independent failure-domain claims. Do not trust a peer snapshot signed only by the bootstrap peer.

### Leave and exclusion
`LeaveNotification { node_cid:CID32, reason:enum, handoff_cids:CID[], membership_epoch:u64, auth:Signature }`
`ExclusionEvent { node_cid:CID32, reason:enum, evidence_hash:Hash, policy_epoch:u64, issued_at:u64, expires_at:u64, quorum_certificate:QuorumCertificate }`

Self-reported leave is advisory, not proof of compromise. Peers stop new placement immediately when an authenticated exclusion/quorum decision is accepted; handoff completes only when replacement replicas return verified receipts.

### CAS and replication
`CASRequest { namespace:NamespaceID, capability:Capability, key:bytes, expected_generation:u64, expected_cid:CID?, new_value_hash:Hash, value_or_reference:bytes, operation_id:bytes, writer_identity:CID32, attestation_ref:Hash, policy_epoch:u64, writer_sig:Signature }`
`CASResponse { outcome:committed|conflict|unauthorized|stale_attestation|no_quorum|invalid|retry, generation:u64?, current_cid:CID?, commit_certificate:QuorumCertificate?, retry_after_ms:u32? }`
`Replicate { namespace:NamespaceID, cid:CID, value:bytes, generation:u64, commit_certificate:QuorumCertificate, placement_epoch:u64, sender_auth:Signature }`
`ReplicaReceipt { namespace:NamespaceID, cid:CID, generation:u64, replica_cid:CID32, failure_domain:FailureDomainID, policy_epoch:u64, persisted_at:u64, durable_until:u64?, auth:Signature }`

Do not replicate a value as authoritative merely because one peer claims CAS success. Replicas verify the commit certificate and content hash. Mutable references require a generation/version and explicit consistency semantics; immutable content blobs can replicate independently.

### Re-attestation
`ReattestRequest { node_cid:CID32, prior_quote_hash:Hash?, new_quote:AttestationQuote, measured_config:MeasuredConfig, challenge:bytes, reason:periodic|firmware_change|config_change|key_rotation|peer_challenge, policy_epoch:u64, identity_sig:Signature }`
`ReattestResponse { accepted:bool, reason:RejectCode?, expires_at:u64, required_next:u64, policy_epoch:u64, verifier_auth:Signature }`

A quote must bind a fresh verifier challenge and measured PCR/event-log digest. A timestamp alone is not sufficient anti-replay. Firmware, boot chain, hypervisor, APEX runtime, isolation policy, security-relevant configuration, or attestation-key changes invalidate the previous attestation and quarantine the node pending a new accepted quote.

### Key rotation
`KeyRotationProposal { node_cid:CID32, old_key_id:Hash, new_attestation_key:PublicKey, new_key_quote:AttestationQuote, challenge:bytes, measurement_digest:Hash, policy_epoch:u64, identity_sig:Signature }`
`KeyRotationCertificate { node_cid:CID32, old_key_id:Hash, new_key_id:Hash, activation_epoch:u64, old_key_cutoff:u64, quorum_certificate:QuorumCertificate }`

If the old key is suspected compromised, do **not** require a valid old-key signature as the only route to recovery. Use the separately specified identity recovery / threshold authorization procedure. Any overlap period is bounded and policy-defined; once cutoff passes, old key acceptance is rejected even by disconnected peers when they rejoin.

## 2. State machines

### Join / rejoin
`DISCOVERING -> ATTESTING -> SYNCING -> WAITING_FOR_QUORUM -> ACTIVE`; any failed gate goes to `QUARANTINED` or `FAILED`.
1. Discover through multiple authenticated bootstrap sources; no single discovery source may dictate membership.
2. Verify identity chain, challenge freshness, measurement policy, revocation state, policy epoch, and failure-domain evidence.
3. Fetch signed membership snapshot and verify its quorum certificate.
4. Rehydrate required shards from surviving eligible replicas and verify hashes/authorization.
5. Become active only after the required independent peers confirm membership and replica placement.
6. On expiry, measurement change, revocation, or policy epoch mismatch, stop quorum participation and new placement until re-attested/re-admitted.

### Graceful leave
`ACTIVE -> LEAVING -> HANDOFF_PENDING -> LEFT`.
Stop accepting new mutations; finish or abort in-flight operations; announce handoff; require verified replacement replica receipts for required CIDs; leave quorum only under membership-epoch rules. A crashed node is handled as failure/exclusion, not as a graceful leave.

### CAS mutation
`PREPARE -> PROPOSE -> QUORUM_COMMIT -> REPLICATE -> COMPLETE`; failure paths are `CONFLICT`, `NO_QUORUM`, `UNAUTHORIZED`, `STALE_ATTESTATION`, or `ABORTED`.
- Prepare content hash, generation precondition, operation ID, capability check, fresh attestation reference, and signature.
- Propose to the configured consensus/quorum protocol.
- Commit only with a verifiable certificate for the same key, expected generation, new CID, membership/policy epoch, and operation ID.
- Replicate until the durability policy's distinct failure-domain target is met. Report **committed** and **durable** as separate states if consensus commit can precede target replication.
- If quorum is unavailable, do not acknowledge a linearizable mutation. Never allow two partitioned groups to independently claim the same linearizable commit.
- Conflicts must be surfaced or resolved under a declared policy; do not blindly retry/adopt arbitrary current CIDs.

**Critical correction:** a strict majority of peers each independently returning CAS success is not, by itself, a consensus protocol. Use a reviewed consensus/atomic-register algorithm with quorum intersection, epochs/terms, fencing, and durable commit certificates—or explicitly choose weaker semantics and surface conflicts. Define how membership changes preserve quorum intersection.

### Re-attestation
`ACTIVE -> REATTESTING -> ACTIVE | QUARANTINED`.
Periodic timer, challenge, expiry, firmware/configuration/key event forces re-attestation. Fresh quote is checked against approved measurement policy, challenge, identity, and current policy epoch. Only authorized verifiers contribute to acceptance; a majority of arbitrary responses cannot override revocation or policy rejection. Failure/timeout removes the node from quorum immediately after its validity window ends.

### Recovery and repair
- On restart, measured boot runs, a fresh quote is obtained, and the previous peer snapshot is treated as a cache—not current authority.
- Rejoin using current signed membership/policy epoch. Rehydrate data from eligible surviving replicas and verify every content hash.
- Mark data under-replicated after peer loss; repair across distinct eligible failure domains and record receipts.
- If surviving copies or key-recovery threshold are insufficient, report data unavailable; never fabricate successful recovery.

## 3. Measured configuration and policy

`MeasuredConfig { platform_class, vendor, firmware_tcb, boot_measurements[], pcr_bank_and_values[], event_log_digest, secure_boot_state, bootloader_digest, kernel_digest, hypervisor_digest?, apex_runtime_digest, storage_adapter_digest, isolation_policy_digest, security_config_digest, attestation_key_id, identity_key_id, policy_epoch }`

Example TPM PCR mapping is platform- and boot-stack-specific; it must be validated against the platform's actual event log and measured-boot implementation. PCR numbers such as 10/11 must not be assumed to mean APEX runtime or capability policy universally. For platforms with a TEE/Secure Enclave, define a separate evidence adapter and threat model; do not pretend its measurements are interchangeable with TPM PCRs.

Acceptance requires:
- Quote verification against a trusted attestation-key certificate/endorsement chain or an explicitly governed decentralized enrollment policy.
- Fresh verifier nonce bound into quote qualifying data and into the signed protocol request; anti-replay state and monotonic policy/membership epoch.
- Event-log replay and digest validation, including measured APEX runtime, storage adapter, isolation policy, and security-relevant configuration where platform measurement supports it.
- Exact match to a versioned accepted configuration policy; unapproved drift means quarantine.
- A signed, content-addressed KnownGoodConfig policy updated by a policy-authorized quorum using the declared consensus protocol. Policy update and membership update must not bypass the same epoch/fencing protections.
- A vendor certificate proves a chain to a vendor root, not that the node is currently uncompromised or that the measured configuration is safe.

## 4. Decentralized key rotation and recovery

### Scheduled rotation
1. Generate new key in the hardware root; bind old/new key IDs, fresh challenge, current measurement digest, and policy epoch in a quote.
2. Verify node identity authorization, quote freshness, accepted measurements, and new key possession.
3. Propose rotation under the membership consensus protocol; peers verify the same transition and issue a quorum certificate.
4. Activate at a specified epoch. Accept the old key only until a bounded cutoff, then reject it. Persist the transition in content-addressed identity history.
5. Disconnected peers must refresh current epoch/revocation state before resuming privileged operations.

### Suspected compromise / lost old key
1. Quarantine the node/key; do not depend exclusively on the suspected key for revocation.
2. Authorize recovery with a pre-established threshold of independent recovery authorities or identity-key guardians, with explicit failure-domain and anti-Sybil assumptions.
3. Publish a quorum-certified revocation and new-key enrollment at a new epoch; preserve audit evidence.
4. Re-attest the node and verify integrity before readmission; otherwise enroll as a new identity.
5. Re-key affected secrets, revoke access grants, and audit data potentially exposed during the compromise window.

### Fleet-wide vulnerability
1. Publish a signed advisory/policy proposal containing affected TCB ranges, fixed versions, deadlines, and emergency exclusions.
2. Apply an explicit bounded grace period only if risk policy permits; high-severity compromise may require immediate quarantine.
3. Stage updates, measure each node, re-attest, rotate/revoke keys as required, and reject old policy/key epochs after cutoff.
4. Avoid a single update server as sole authority; use signed artifacts, diverse distribution, quorum-authorized policy changes, and independently verifiable provenance.

### Permanent node loss
- Store no indispensable data or sole recovery key exclusively under one node's non-migratable hardware key.
- Replicate encrypted content and recovery metadata to independent failure domains while the node is healthy.
- Use threshold secret sharing only with a documented threshold, independent holders, key refresh/revocation, and an authorization path that does not depend solely on the lost node.
- Re-replicate from surviving verified copies after loss; declare unrecoverable data explicitly if the surviving threshold is insufficient.

## 5. Minimum adversarial conformance suite

1. Header length, payload length, canonical encoding, unknown-critical flags, downgrade, malformed CID, and allocation-limit tests.
2. Forged signature, wrong sender CID, wrong recipient/role, nonce replay, quote replay, expired quote, stale epoch, and revocation-cache tests.
3. Firmware/runtime/isolation/config digest change invalidates prior attestation and quorum eligibility.
4. Two concurrent CAS writers, stale generation, retries, duplicate operation ID, and network partition cannot create two accepted linearizable commits.
5. Duplicate failure domains, Sybil identities, poisoned bootstrap, and eclipse simulation cannot inflate quorum or silently establish trust.
6. Node loss, restart, corruption, missing replica, and repair prove data integrity and configured replication across independent live hosts.
7. Old-key rejection after cutoff; rotation while a peer is disconnected; recovery when old key is compromised; no unilateral revocation/rotation.
8. Cross-namespace capability substitution, leaked/expired handle, worker confused deputy, and app-level lost update.
9. Vendor/TCB revocation, emergency policy change, rollback, and staggered fleet upgrade.
10. Every receipt and result can be independently read back and tied to exact commit, policy epoch, peer/failure-domain identities, and test evidence.

## 6. Evidence and release gates

Track each control as **specified**, **implemented**, **automated-tested**, **live-tested**, or **independently verified**. Each transition requires evidence for the exact source commit and deployed revision where applicable.

Before release:
1. Inventory all six apps, shared system/worker namespaces, routes, provider egress, persistence paths, identities, capabilities, and control-plane operations.
2. Correctly wire a multi-namespace peer storage facade; migrate asset/manifest writes only after preservation and recovery are demonstrated.
3. Pass adversarial tests and required CI on the exact candidate commit.
4. Prove independent-host persistence, restart, partition, peer-loss, recovery, repair, attestation expiry/revocation, and key rotation.
5. Stage with a non-critical namespace; verify receipts and independent read-back; expand only after owner approval.
6. Keep the release unmerged/undeployed while any required gate is open.

This is a concrete protocol proposal. It does not claim current runtime enforcement, production durability, or absolute security.
