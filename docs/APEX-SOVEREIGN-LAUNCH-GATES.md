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
- [x] Parallel peer reads for immutable objects and bounded concurrent chunk assembly.
- [ ] Rarest-first scheduling based on authenticated, expiring chunk-availability advertisements.
- [ ] Peer-driven replication-factor monitoring and automatic repair after peer loss.
- [ ] Hardware-root attestation and physical failure-domain proof; current environment-variable failure-domain labels are not hardware proof.
- [ ] Connection-scoped trust elevation with explicit credential rotation, connection teardown, and revocation behavior.
- [ ] Signed peer heartbeats and decentralized liveness expiry.
- [ ] Signed peer capability advertisements for app permissions, trusted hardware roots, and held CIDs.
- [ ] Versioned access-control tensors stored as CIDs and atomically published through a CAS pointer.
- [ ] Short-lived cross-app capability CIDs with path scope, operation scope, expiry, issuer binding, and replay protection.
- [ ] Deterministic distributed job claims with lease fencing under simultaneous worker races.
- [ ] Job results published as immutable CIDs and retrievable without the originating worker.
- [ ] Optional erasure-coded shard storage and k-of-n reconstruction.
- [ ] Bounded speculative prefetch of referenced small CIDs.
- [ ] Per-app CPU, memory, storage, and concurrent-job quotas enforced inside the runtime.
- [ ] End-to-end performance and fault-injection suite, with published measurements.

## Required prelaunch evidence

1. **App isolation:** all six app credentials tested against all six namespaces; all unauthorized combinations denied.
2. **CAS correctness:** concurrent swaps from independent workers, stale expected hashes, replayed writes, duplicate delivery, and interrupted partial replication.
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
