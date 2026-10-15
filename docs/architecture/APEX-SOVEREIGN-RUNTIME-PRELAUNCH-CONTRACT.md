# APEX Sovereign Runtime — Pre-launch implementation contract

Status: living implementation contract. A listed requirement is **not complete** until its code, negative tests, and runtime evidence pass.

## Hard rules

- No GitHub or Railway as production storage/control-plane dependencies at launch.
- No PostgreSQL, JSON persistence/protocol, WAL/recovery log, local-disk fallback, or coordinator-owned source of truth.
- Immutable objects use canonical CBOR and content IDs (CID = SHA-256 of canonical bytes). Mutable names are CAS pointers to immutable CIDs.
- Every app has an independent namespace, credential, encryption key, authorization tensor CID, quota, and peer policy. Default deny across apps.
- A write must be rejected before acceptance if its destination cannot prove remaining capacity. No unbounded retry, silent overflow, or spill to local storage.
- CI must not retain media artifacts in hosted artifact storage. Smoke outputs stay ephemeral unless explicitly exported by the user to an approved peer-owned destination.
- Every storage API has configured hard limits for object size, aggregate bytes, concurrent transfers, chunk count, cache bytes, TTL, and queued work. The peer storage backend must enforce capacity atomically; client-side counters alone are not proof of capacity.

## Implemented on the current work branch

- Bounded verified-object RAM cache: default 8 MiB, 30-second TTL, LRU eviction, disabled with a zero-byte budget; no persistence.
- Parallel blob-chunk retrieval: up to eight concurrent chunk reads; manifest capped at 8,192 chunks; each chunk and the complete reconstructed blob are integrity-checked.
- Peer-CAS adapter validation now accepts only individually validated slash-delimited key segments.
- Legacy filesystem/WAL bridge tests are being replaced by volatile peer-CAS contract fixtures.
- KernelVision smoke renders an illustrated Joseph episode through the production episode pipeline. It is explicitly synthetic, unverified, and not release-eligible. CI artifact retention was removed to avoid consuming hosted artifact quota.

These are branch changes only until checks pass and review is complete. The RAM cache and volatile fixtures do not establish durable peer storage.

## Required implementation and acceptance evidence

1. **Local CAS fast path:** hash/verify immutable bytes once; zero-copy views where ownership permits; atomic in-memory pointer swap; benchmark p50/p95/p99 and prove no aliasing/mutation bypass.
2. **Bounded capacity:** peer-owned atomic byte reservations, per-app quotas, transfer/concurrency limits, pressure signals and backpressure. Test at-limit, concurrent reservations, cancellation, peer restart, and no disk spill. A full peer must reject before acknowledging a write.
3. **Chunk swarm:** signed per-peer chunk availability and counts; rarest-first scheduling; bounded parallel fetch across independent peers; verify every chunk and whole-asset CID; resume from surviving peers.
4. **Re-replication:** detect replica/failure-domain shortfall from signed heartbeats/receipts; peers independently repair to the configured replication target; no coordinator; no infinite retry loops; capacity checked before repair.
5. **Connection-scoped trust:** authenticate hardware attestation and app credential once per authenticated connection; bind cache entry to connection ID, peer ID, app namespace, attestation generation and credential version; invalidate on disconnect, key rotation, revocation, or policy change. Never skip per-request authorization.
6. **Hardware-root failure domains:** attested TPM/Secure Enclave identities and signed proof chain; domain diversity derived from attested hardware identity, not IP or self-asserted labels. Unsupported/unverifiable roots fail closed.
7. **Application isolation:** six separate app credentials/keys and namespace ACL tensor CIDs enforced inside peer runtime; negative tests for every cross-app read, write, list, delegation and cache hit.
8. **CID-only records:** records, assets, jobs, credentials, capability tokens, heartbeats, advertisements, and ACL tensors are immutable CIDs; mutable heads are CAS references. No JSON or WAL storage path.
9. **Job execution:** deterministic CAS claim; lease fencing; idempotent result CID; any authorized peer can fetch result by CID; explicit semantics for external side effects.
10. **ACL tensor versioning:** publish a new immutable tensor CID, CAS the active pointer, verify signatures and monotonically increasing policy version; revocation must invalidate cached trust/capabilities.
11. **Peer advertisements and liveness:** signed, expiring advertisements for supported apps, attested roots and held CIDs; signed heartbeat CIDs with replay/clock bounds; no central membership service.
12. **Delegated capabilities:** signed, short-lived CID tokens scoped to app, path, operation, expiry, audience and nonce; prevent replay and privilege escalation; delegation cannot widen parent scope.
13. **Optional erasure coding and prefetch:** k-of-n reconstruction with shard integrity and bounded speculative RAM budget; prefetch only referenced small CIDs and never bypass authorization/quota.
14. **BFT CAS protocol:** current sequential replica writes are not global atomic CAS. Before production writes, use a reviewed protocol with explicit fault assumptions, membership epochs, operation IDs, committed decisions and recovery. A simple replica majority or two-phase write loop must not be called Byzantine consensus.
15. **Restart and peer-loss proof:** with RAM empty and no local persistent state, restart must recover committed heads and objects from independent peers; below-quorum or ambiguous decisions fail closed.
16. **Measurements:** publish reproducible p50/p95/p99 latency for 0/1/f Byzantine peers, convergence after peer loss, independent-app CAS throughput, N-peer asset retrieval, memory-only post-restart behavior, repair bytes, quota rejections and cache hit rate. Label simulations separately from real hardware/network runs.

## Release blockers

- Prove which peer-owned storage implementation is actually available and its enforceable capacity API before directing production writes to it.
- Complete durable capacity reservation, rarest-first chunk advertisements, attested hardware identity, connection-bound trust cache, signed heartbeat/capability protocols, versioned ACL tensors, peer-driven repair, and reviewed BFT CAS.
- Run real multi-process tests with independent peer stores; restart processes, remove a peer, fill a peer to quota, partition below quorum, inject conflicting/Byzantine responses, and verify no data loss or false success.
- Do not claim sovereignty, zero-disk persistence, or launch readiness from unit tests, CI green, or a successful render alone.
