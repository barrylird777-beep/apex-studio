# Sovereign Mesh Verification Roadmap

## Purpose

Move from timing-dependent integration tests toward reproducible fault exploration for the remote CAS/WAL, libp2p peer mesh, durable dispatch, and Opportunity Engine. This is a staged verification program, not a claim that the whole distributed system is already simulated or formally proven.

## Stage 1 — Deterministic simulation substrate

Implemented on this branch:
- Seeded pseudo-random decisions and a virtual clock.
- Stable single-threaded event ordering and replayable traces.
- Simulated packet loss, latency/jitter, and pairwise network partitions.
- A bounded mock disk that injects ENOSPC without mutating a previously committed value.
- Regression tests for same-seed replay, partitions, packet loss, timer ordering, disk exhaustion, and runaway-event detection.

Boundary: this simulator models only components explicitly connected to its clock/network/disk interfaces. It does not intercept Node.js's real event loop, sockets, libp2p internals, or the live remote provider.

## Stage 2 — Deterministic protocol adapters

Wrap the production protocols behind injected interfaces for:
1. Clock and lease expiry.
2. Transport send/receive and peer membership.
3. Remote CAS read/write/compare-and-swap.
4. WAL append, replay, hash verification, and recovery.
5. Idempotency keys and job claim/heartbeat/complete transitions.

Every failing test must emit the seed, virtual timestamp, event trace, and minimized operation history. Preserve the existing real-provider tests; simulator success must never substitute for integration evidence.

## Stage 3 — Linearizability history checker

Record invocation/response histories for job claim, WAL append, and idempotency operations. Check whether each concurrent history can be ordered into a legal sequential specification. Explicitly test split-brain partitions, duplicate delivery, stale leases, peer restart, clock rollback, and CAS conflicts. Never describe a passing randomized test as a mathematical proof.

## Stage 4 — Adversarial live chaos

Only run against a disposable staging namespace with synthetic jobs and explicit resource/time limits:
- Isolate a peer, then heal the partition.
- Inject controlled packet loss and latency.
- Restart/kill a staging peer during append/claim.
- Expire leases and simulate clock skew at the adapter layer.
- Validate recovery, duplicate suppression, and no double-claim.

Do not inject chaos into production or mutate production WAL records. Live provider faults should use a separate test namespace and cleanup-safe probe IDs.

## Stage 5 — TLA+ state model

Model WAL head/record commit ordering, hash-chain linkage, lease ownership, idempotency keys, and job claim/reassignment. State invariants should include:
- Committed records have valid predecessor hashes.
- A job has at most one valid lease owner at a time.
- Duplicate operation keys do not create duplicate committed effects.
- A recovered head never points past a verified committed record.
- Safety is preserved during partitions, while liveness is conditional on eventual communication and available storage.

Run TLC over bounded peer/job/state spaces and keep the model plus counterexample traces in CI. TLA+ explores the declared model and bounds; it does not automatically prove unmodeled implementation behavior.

## Stage 6 — Byzantine behavior and membership

Before adding voting, specify membership, authenticated peer identity, quorum rules, and the fault model. Raft tolerates crash faults, not arbitrary Byzantine behavior; do not label Raft alone Byzantine fault tolerant. If Byzantine tolerance is required, evaluate a protocol with explicit authenticated quorum assumptions and a clear bound on faulty members. Add invalid-hash gossip, equivocation, forged acknowledgements, and quarantine/reassignment tests.

## Release gates

- Deterministic tests are reproducible from a printed seed.
- Real CAS/WAL integration tests still pass.
- Linearizability checker finds no invalid history in bounded adversarial schedules.
- TLA+ invariants hold for declared bounds and assumptions.
- Staging chaos tests recover without double claims, lost acknowledged records, or hash-chain forks.
- No production rollout until the relevant CI gates pass.
