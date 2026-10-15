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
- Connection-scoped trust-session primitive with explicit credential and attestation verifier callbacks; credential rotation and connection closure invalidate elevation.
- Job completion publishes an immutable apex.job-result.v1 object and records its CID in the CAS-backed job state.
- Distributed job claims use CAS expected hashes, lease tokens, monotonically increasing fencing values, and a concurrent-winner regression test; release verification remains pending.

## Not yet launch-verified

- The access-tensor evaluator and capability verifier are security primitives; the full runtime still needs to route every state, asset, job, and credential operation through the active tensor policy and trusted capability verifier.
- The signed heartbeat and capability-advertisement helpers are not yet a complete libp2p gossip protocol. The rarest-first planner is not yet wired into the asset client's live source-selection path.
- Hardware-root attestation is not established merely by a peer ID, certificate, environment label, or hardwareRootCid field. A platform-backed verifier must validate fresh signed hardware evidence and bind it to the live peer connection and app credential.
- Connection trust elevation must be wired to the transport's actual connection lifecycle and credential rotation events before repeated authentication can be skipped safely.
- Automatic repair depends on each peer being able to enumerate referenced CIDs and still reach enough verified replicas. The loop fails closed and reports repair errors; it cannot restore data when no valid source survives.
- Rarest-first retrieval, erasure coding, speculative prefetch, resource-budget enforcement, Byzantine fault measurements, sub-millisecond latency, and zero-filesystem-write-after-restart still require dedicated integrated tests and measured evidence.
- No live six-app restart/peer-loss proof is implied by unit tests. The PR must remain draft until current-head CI passes and independent live peers prove replica receipts, app isolation, recovery, and absence of persistent local fallback.

## Non-negotiable behavior

- No PostgreSQL, WAL, JSON persistence, paid bucket, or local persistent source-of-truth fallback.
- Memory caches are disposable accelerators only; a cache hit never substitutes for verified durable peer receipts.
- A CAS conflict is not a replica failure. A missing quorum, invalid receipt, corrupt CID, or incomplete repair is a hard failure.
- Do not publish performance claims until benchmarks report p50/p95/p99 latency, throughput, peer count, fault count, and convergence time from repeatable runs.
