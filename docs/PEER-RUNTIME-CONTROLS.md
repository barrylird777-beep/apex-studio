# APEX Peer Runtime Controls

This document records implementation status, not a sovereignty or production-readiness claim.

## Implemented in this branch

- Per-app bridge credentials and six distinct app-scoped peer CAS instances.
- CAS conflict handling that distinguishes a conflict from replica failure.
- Bounded concurrent immutable-object replication with a configurable write concurrency ceiling; writes still count only verified durability receipts toward the configured quorum.
- Encrypted immutable peer objects, verified replica receipts, bounded TTL/LRU RAM cache, and chunked binary manifests with end-to-end SHA-256 verification.
- Parallel immutable-object reads and bounded parallel chunk assembly.
- PeerContentAddressedStore.reconcileObject(cid) verifies source replicas and attempts to restore missing replicas without accepting unverified bytes.
- PeerContentAddressedStore.startRepairLoop({ getCids, ... }) provides bounded pull-based repair. The peer CAS runtime starts it by default; set APEX_PEER_CAS_REPAIR_ENABLED=false only to disable it. The loop derives candidates from CIDs referenced by verified peer CAS references.
- Versioned access-tensor construction, deterministic CID derivation, default-deny path evaluation, per-app quota checks, and CAS-pointer publication after the immutable tensor has verified replica receipts.
- Ed25519-signed capability envelopes, scoped cross-app capability verification, revocation callback, signed heartbeats, signed peer capability advertisements, and a rarest-first planning function that consumes already-verified advertisements.
- Connection-scoped trust-session primitive is wired into the libp2p send path before request bytes are written; credential rotation and connection closure invalidate elevation. A platform provider must bind the actual stream to its live connection and attest it.
- Job completion publishes an immutable apex.job-result.v1 object and records its CID in the CAS-backed job state.
- Job claims use CAS expected hashes, lease tokens, monotonically increasing fencing values, bounded convergence retries, and concurrent-winner/lease-reclaim regression tests. These tests use an in-memory peer simulation and do not establish Byzantine-safe global atomic CAS.

## Not yet launch-verified

- **Critical consensus gap:** the Ed25519 quorum-certificate primitive and its signature/equivocation tests already exist in `src/testing/sovereign-bft-quorum.mjs`, but they are not wired into mutable storage CAS. References are currently CAS-updated sequentially across replicas, which is not globally atomic Byzantine-fault-tolerant CAS. The runtime now refuses startup without an explicit BFT commit-provider module and positive membership epoch. The provider itself is not yet included: the reviewed commit-decision protocol, validator vote-lock persistence, and interrupted-commit recovery still must be implemented and fault-tested before production writes or merge.
- The access-tensor evaluator and capability verifier are security primitives; the full runtime still needs to route every state, asset, job, and credential operation through the active tensor policy and trusted capability verifier.
- The signed heartbeat and capability-advertisement helpers are not yet a complete libp2p gossip protocol. The rarest-first planner is wired into `PeerContentAddressedStore.getBlob` when a provider supplies fresh, signature-verified advertisements; live decentralized advertisement exchange and end-to-end source-selection proof remain open.
- Hardware-root attestation is not established merely by a peer ID, certificate, environment label, or hardwareRootCid field. A platform-backed verifier must validate fresh signed hardware evidence and bind it to the live peer connection and app credential.
- The transport hook is wired, but runtime startup requires a platform provider that resolves the live connection for each stream and verifies credential/attestation callbacks. Live reconnect, rotation, revocation, and hardware-backed tests remain required.
- Automatic repair depends on each peer being able to enumerate referenced CIDs and still reach enough verified replicas. The loop fails closed and reports repair errors; it cannot restore data when no valid source survives.
- Rarest-first retrieval still needs an integrated source-selection regression against multiple independently controlled peers. Erasure coding, speculative prefetch, resource-budget enforcement, Byzantine fault measurements, sub-millisecond latency, and zero-filesystem-write-after-restart still require implementation and/or measured evidence.
- No live six-app restart/peer-loss proof is implied by unit tests. The PR must remain draft until current-head CI passes and independent live peers prove replica receipts, app isolation, recovery, and absence of persistent local fallback.

## Non-negotiable behavior

- No PostgreSQL, WAL, JSON persistence, paid bucket, or local persistent source-of-truth fallback.
- Memory caches are disposable accelerators only; a cache hit never substitutes for verified durable peer receipts.
- A CAS conflict is not a replica failure. A missing quorum, invalid receipt, corrupt CID, or incomplete repair is a hard failure.
- Replica write quorum is not consensus: no production claim may describe the current sequential multi-peer reference update as globally atomic or Byzantine-safe.
- Do not publish performance claims until benchmarks report p50/p95/p99 latency, throughput, peer count, fault count, and convergence time from repeatable runs.
