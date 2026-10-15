# APEX Sovereign Runtime — Prelaunch Gates

This is an implementation and evidence checklist, not a claim that the features are already complete. The release stays blocked until each required gate has implementation, automated regression coverage, and live peer evidence. No PostgreSQL, WAL, JSON persistence, paid service, or local persistent fallback is permitted as the source of truth.

## Required architecture invariants

- Six canonical apps: KernelVision, XShield, Kernelodies, PlanetApeX, KashKorner, KoinKob.
- Runtime-enforced app credentials, app-specific encryption keys, namespaces, and quotas. Cross-app access is denied unless a scoped cryptographic capability explicitly delegates it.
- Immutable data and mutable pointers use content-addressed objects plus atomic CAS. Every write must verify replica receipts and the configured independent failure-domain policy.
- A failed quorum, invalid attestation, missing peer, conflicting CAS, corrupt CID, or incomplete repair fails closed. No local disk, WAL, JSON log, database, or paid bucket fallback.
- Memory caches are disposable accelerators only. They are bounded, TTL-limited, integrity-verified, and never treated as durable state.
- Hardware-root trust cannot be claimed from a peer ID, IP address, TLS certificate, or self-asserted label. Hardware attestation needs a platform-backed verifier and signed evidence bound to a live challenge.

## Implementation status in this branch

- [x] Authenticated local IPC bridge with separate credentials for all six app identities.
- [x] App-scoped CAS adapter and cross-app isolation regression test.
- [x] Content-addressed chunked asset manifest and integrity verification.
- [x] Atomic CAS conflict surfaced distinctly from replica failure.
- [x] Bounded TTL RAM cache for verified immutable object bytes; cache is non-durable.
- [x] Synchronous in-memory CID index and atomic pointer swap primitive integrated only beneath the disposable verified-object cache; it never substitutes for distributed CAS or peer durability.
- [x] Local CAS microbenchmark command added; measured numbers are not release evidence until run on the candidate environment and reported with the runtime context.
- [x] Parallel peer reads for immutable objects and bounded concurrent chunk assembly.
- [x] Mutable-reference reads and listings require the configured verified replica count and independent failure-domain quorum; they fail closed when the read quorum is unavailable.
- [x] Rarest-first planning and `getBlob` source selection use fresh, signature-verified advertisements; live multi-peer advertisement gossip and production source-selection proof remain open.
- [x] Bounded pull-based repair loop and replica reconciliation are implemented; peer-loss convergence remains unverified in a live mesh.
- [x] Runtime now requires fresh challenge-bound hardware-root evidence for every configured peer and derives failure-domain labels from the verifier provider; production remains blocked until a real platform-backed provider is configured and its evidence is validated.
- [x] Connection-scoped trust-session primitive is wired before libp2p request bytes are sent and revalidates on credential rotation/reconnect; platform-provider and live lifecycle evidence remain open.
- [x] Signed heartbeat primitive verifies freshness, peer identity, and hardware-root evidence; decentralized gossip/liveness integration remains open.
- [x] Signed capability-advertisement primitive and CID availability planner exist; live advertisement exchange remains open.
- [x] Versioned access-tensor CID and atomic pointer publication primitive exist; initial policy provisioning and enforcement coverage remain open.
- [x] Signed short-lived cross-app capability primitive includes scope, expiry, issuer/subject binding, and replay protection; production key lifecycle/integration remains open.
- [x] Deterministic distributed job claims use atomic CAS, lease tokens, monotonic fencing values, and now have a simultaneous-worker race regression; current-head CI and live peer evidence are still required.
- [x] Job completion publishes an immutable result CID and validates the configured replica receipts; cross-peer retrieval regression coverage is still required before this is considered launch-verified.
- [ ] Optional erasure-coded shard storage and k-of-n reconstruction.
- [x] Bounded, sequential speculative prefetch of explicitly referenced small CIDs into the disposable RAM cache; aggregate byte/CID limits enforced and prefetch failures never become durable state.
- [x] Blob ingestion/retrieval rejects oversized assets, excessive chunk counts, and manifests whose declared chunk lengths do not exactly match the total before assembling the payload.
- [ ] Quota tensor evaluation exists and now fails closed when a configured metric is missing; trusted per-app usage metering is not yet wired, so quota-enabled storage remains blocked.
- [ ] Unit/fault tests exist for core primitives; end-to-end Byzantine/restart/peer-loss measurements are not yet published.

## Required prelaunch evidence

1. **App isolation:** all six app credentials tested against all six namespaces; all unauthorized combinations denied.
2. **CAS correctness:** concurrent swaps from independent workers, stale expected hashes, replayed writes, duplicate delivery, and interrupted partial replication. This must be backed by a reviewed BFT commit protocol; replica quorum alone is insufficient.
3. **Byzantine tolerance:** latency and correctness under 0, 1, and f faulty peers; never report a result as durable unless the configured quorum and failure-domain policy are satisfied.
4. **Peer loss:** remove a replica during read/write, verify convergence and repair from remaining authorized peers, and prove repair never selects corrupt or stale data.
5. **Restart recovery:** terminate and restart peers with all local persistent state unavailable; recover references and assets from the peer mesh only.
6. **RAM-only cache:** verify TTL expiry, size eviction, tamper rejection, and zero filesystem writes by the cache path.
7. **Large assets:** report end-to-end retrieval time at several peer counts, parallel chunk assembly, integrity verification, and behavior when chunks become unavailable.
8. **Scheduling:** race multiple workers for one job CID; prove one valid lease winner, fencing of expired workers, and result-CID retrieval from a different peer.
9. **Trust:** verify hardware evidence against a fresh challenge, reject spoofed/stale evidence, rotate credentials, close/reopen connections, and test revocation.
10. **Performance report:** publish p50/p95/p99 latency, throughput, convergence time, peer counts, fault counts, and memory use. Do not publish sub-millisecond or zero-disk claims without instrumented measurements.

## Launch policy

A passing unit test or CI workflow is not proof of live sovereign durability. Keep the integration PR draft until automated checks pass on its current head and live multi-peer tests demonstrate quorum receipts, app isolation, restart recovery, peer-loss repair, and the no-persistent-fallback invariant. Do not deploy automatically from this branch.
