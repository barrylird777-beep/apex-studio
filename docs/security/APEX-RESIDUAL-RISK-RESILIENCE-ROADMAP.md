# APEX Residual-Risk Elimination and Resilience Roadmap

Status: **engineering roadmap / requirements; not evidence of implementation**

## Objective
Continuously reduce, detect, contain, and recover from residual risks in peer-owned storage and the APEX six-app system. "Eventually" means an iterative engineering target with measurable gates, not a promise of perfect or permanent security. Preserve decentralized operation where feasible; explicitly document any trust anchor or coordination assumption that remains.

## A. Hardware root-of-trust and post-attestation compromise
- Use short, policy-bounded attestation lifetimes with jittered refresh, fresh nonces, anti-replay, and operation-time freshness checks for sensitive placement/quorum/key actions.
- Bind attestations to measured firmware, boot chain, hypervisor/runtime, storage implementation, security configuration, peer identity, role, and policy version.
- Treat firmware/configuration/software/key changes as immediate invalidation events; quarantine pending re-attestation and measured-state policy evaluation.
- Add behavioral signals and peer challenge-response between attestations. Attestation alone never proves continuous integrity.
- Maintain vulnerability inventory, vendor advisory intake, staged canary rollout, emergency quarantine, revocation/re-issuance, and rollback policy. Never assume a device remains trustworthy because a patch is available.
- State physical attack assumptions per hardware class; treat TPM/TEE evidence as useful but bounded, not unforgeable under every physical attack.

**Acceptance tests:** expired/replayed quote rejected; altered measurements rejected; change event invalidates trust immediately; stale cache cannot restore trust; emergency revocation propagates to writers, readers, schedulers, repair, and key release; compromised single node cannot satisfy threshold.

## B. Replication durability, partitions, and CAS consistency
- Define the consistency model per operation: linearizable quorum, fenced single-writer lease, or explicitly eventual/conflict-resolving semantics. Do not allow two partitions to independently claim the same linearizable authority.
- Bind CAS updates to expected version/generation and use compare-and-swap preconditions; reject stale writes. For multi-writer semantics, define deterministic, auditable conflict resolution and preserve conflicting versions rather than silently discarding them.
- Require write acknowledgements from the configured number of eligible replicas across independently verified failure domains. Durable receipts bind content hash, namespace, generation, replica identities, failure domains, policy, and actual quorum.
- On partition or quorum loss, make degraded/unavailable/conflicted state visible to applications. Never report a write as durably committed without quorum.
- Test peer restart, loss, corruption, network partition, healing, re-replication, concurrent CAS, and sustained node churn using independent hosts. In-memory fixtures are not physical durability evidence.

**Acceptance tests:** partition cannot produce two accepted linearizable commits; stale generations fail; degraded status is explicit; healing converges under the specified model; peer loss triggers repair; data survives a silicon/node loss if the configured surviving replica threshold remains.

## C. Discovery, Sybil, eclipse, and exclusion
- Bootstrap from multiple independently authenticated seed sources and pin a versioned, signed trust policy; do not accept a peer merely because discovery returned it.
- Authenticate peer identity and validate current attestation after discovery and continuously refresh the eligible peer set. Detect sudden peer-set isolation, suspicious topology changes, and concentration of peers under one operator/failure domain.
- Use quorum and failure-domain constraints to limit Sybil impact. Attestation is one signal, not a complete Sybil defense. Explicitly state hardware scarcity and identity-provisioning assumptions.
- Distribute revocation/exclusion evidence through independently validated channels; require fresh challenges and policy checks for re-admission. Avoid reputation as sole authority.

**Acceptance tests:** malicious discovery feed cannot force trust in invalid peers; eclipse simulations trigger isolation warnings and safe degraded mode; duplicated identities/domains do not inflate quorum; revoked peers cannot rejoin using cached status.

## D. Namespace/capability isolation and application semantics
- Use narrowly scoped, unforgeable capabilities bound to app namespace, operations, expiry, and policy version. Never treat an opaque handle as safe if it can be serialized or leaked without control.
- Keep authorization checks at every storage API boundary; validate ownership and namespace on reads, writes, list, delete, repair, job/worker and administrative paths.
- Add capability leak, confused-deputy, cross-namespace, compromised-worker, and forged-handle adversarial tests across all six canonical apps plus shared system/worker namespaces.
- Document hardware side channels as residual where co-location exists; isolate high-risk workloads by host/failure domain when required and test timing/resource isolation where feasible.
- Require generation preconditions and application-level invariants on CAS operations. CAS integrity alone does not guarantee correct application logic.

**Acceptance tests:** one app's handle cannot access another namespace; expired/revoked capabilities fail; worker identity cannot elevate authority; stale update rejected; all routes and background jobs are included in authorization coverage.

## E. Bootstrap, policy evolution, and key lifecycle
- Version and sign bootstrap trust bundles; document initial provisioning authority, quorum needed to change trust roots, recovery if the initial authority is lost, and protections against one-person unilateral changes.
- Use a versioned measured-configuration policy with staged rollout, canary attestation, rollback that still requires fresh attestation, and explicit policy expiry.
- Rotate/revoke compromised keys with bounded propagation time; support overlapping keys only under an explicit short-lived transition policy that cannot keep revoked keys valid.
- Design recovery and key escrow/threshold recovery before deployment. Do not seal the only copy of indispensable data or recovery material to one non-migratable root.
- Audit policy changes and retain prior policy/evidence for investigation without treating superseded policy as currently trusted.

**Acceptance tests:** revoked keys fail within the stated propagation objective; policy rollback requires fresh attestation; lost bootstrap authority can be recovered under documented threshold; no single root or node holds irreplaceable data/recovery authority.

## F. Churn, correlated failure, supply chain, and operations
- Replicate across independently verified power, network, hardware, administrative, and geographic failure domains appropriate to the threat model.
- Track replica health, repair backlog, remaining quorum margin, churn, correlated failures, attestation freshness, policy drift, and time-to-exclusion.
- Define SLOs for detection, revocation propagation, repair, recoverability, and availability during churn. Trigger alerts before redundancy drops below policy.
- Maintain an SBOM, reproducible/provenance-checked builds where feasible, signed release artifacts, dependency and firmware advisory tracking, and staged rollouts. Model a vendor-wide compromised update as a correlated failure, not an independent-node event.
- Use resource/accountability controls for peer admission without letting one central operator silently become the sole trust authority. State remaining Sybil assumptions.

**Acceptance tests:** simulated attrition maintains the stated durability objective or explicitly transitions to degraded mode; correlated vendor update can be quarantined; supply-chain provenance gates release; no unverified host is counted as an independent domain.

## G. Evidence discipline and staged rollout
Every control carries one status: **specified**, **implemented**, **automated-tested**, **live-tested**, **independently verified**. A status change requires linked evidence for the exact commit and deployed revision where applicable.

Release gates:
1. Inventory all six apps, shared services, workers, routes, provider egress, persistence paths, identities, capabilities, and control-plane operations.
2. Implement and test multi-namespace peer-storage facade; eliminate unapproved system-of-record fallbacks only after preservation and recovery verification.
3. Pass adversarial unit/integration tests and exact-head CI.
4. Prove independent peer persistence, restart recovery, peer-loss recovery, repair, quorum receipts, and attestation revocation on operator-controlled live hosts.
5. Stage to a non-critical namespace, monitor, verify independent read-back, then expand only after owner approval.
6. Keep deployment blocked while required gates are open. Do not imply a design document is runtime enforcement.

## Immediate known blocker
The existing storage migration remains incomplete: the production guard must fail closed without breaking module import; the main server needs correctly scoped peer storage across six apps plus system/worker namespaces; project asset/manifest writes still have a local filesystem path; and independent-host durability/recovery has not been demonstrated. This roadmap does not close those blockers by itself.
