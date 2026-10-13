# APEX Sovereign Cloud-Exit Architecture

Status: implementation contract and migration gate. This document does not claim that cloud dependencies have already been removed.

## Objective

Move the six canonical APEX apps away from hosted application platforms and hosted object storage as mandatory control-plane or system-of-record dependencies. Use the existing APEX peer mesh, content-addressed objects, authenticated peer receipts, and the proven on-device Local AI runtime as the foundation.

Canonical apps (and only these six):
- PlanetApeX — research, Bible study, knowledge, analytics, and the GardenApex universe.
- KernelVision — media/production studio.
- Kernelodies — music and audio.
- XShield — security, privacy, and network protection.
- KashKorner — cash and financial transaction surfaces.
- KoinKob — autonomous economy and asset/worker coordination.

Keep app identities and data namespaces isolated. Shared transport does not mean shared private data.

## Non-negotiable constraints

- $0 incremental spend. Do not provision paid services, paid storage, or new subscriptions.
- Preserve existing data and history. No destructive cutover, reset, or deletion as part of migration.
- No PostgreSQL, SQL/SQLite, active WAL/append-log writes, or device-local storage as the system of record.
- A browser cache or iPhone filesystem may hold an explicitly disposable cache/model copy, never the only durable copy of user/project data.
- Do not route private payloads to third-party AI or storage providers without explicit policy and consent. Local inference is preferred; external providers remain optional, allowlisted, and secret-scrubbed.
- Do not claim production sovereignty, unlimited capacity, offline write durability, or global availability without measured end-to-end evidence.

## Target topology

1. **Phone edge:** iPhone-first web/PWA control surface; local GGUF inference when the model is present; queue bounded, user-visible offline actions only when the data can be safely reconciled later.
2. **Peer identity and transport:** authenticated Noise/libp2p peers, stable peer identities, allowlisted connections, replay protection, signed receipts, and explicit readiness checks. Public HTTPS is a bootstrap/compatibility path, not proof of P2P.
3. **Content plane:** immutable SHA-256-addressed chunks and manifests. Encrypt private data before replication; separate encryption keys from replicated objects. The initial AES-GCM primitive uses a fresh random nonce, so hashes identify encrypted envelopes and identical plaintext is intentionally not deduplicated across separate writes. Use deterministic manifests, integrity verification, resumable chunk transfer, and compare-and-swap metadata updates.
4. **Replication:** select peers based on verified identity, free capacity, uptime, bandwidth, and failure-domain diversity. Require acknowledgements from independent peers before marking a durable write committed. Keep configurable replica counts and repair missing replicas.
5. **Placement and recovery:** per-app namespace and access policy; no cross-app reads by default. Verify hashes on every read; quarantine corrupt replicas; rebuild indexes from immutable objects/manifests. Garbage collection must be mark-and-sweep with a grace period and a dry-run report before any deletion.
6. **Provider boundary:** storage and compute provider adapters must expose their current mode. Hosted storage is an optional bridge during migration, not an invisible required dependency. A migration cannot declare success while a required active path still writes to hosted storage or relies on a single service's ephemeral disk.

## Capacity: what “practically limitless” can mean

Capacity can grow by adding willing peers and their available disk, memory, compute, and bandwidth. It is not literally unlimited: usable capacity is bounded by participating resources, replication overhead, churn, and network availability. Report measured *usable* capacity after reserving space for replicas and repair; never count advertised or unreachable peer capacity. The system must reject writes safely when it cannot meet its durability policy instead of silently accepting a single unreplicated copy.

## Migration sequence and gates

### Gate 0 — inventory (read-only)
- Inventory every active runtime, service, storage adapter, environment variable, route, and write path across all six apps.
- Identify hosted platform dependencies, object-store endpoints, ephemeral filesystem writes, and remaining legacy WAL/SQL references.
- Capture baseline checksums and current peer identities. Do not alter or delete source data.

### Gate 1 — peer storage primitive
- Implement a peer-backed content-addressed storage adapter behind the existing storage interface.
- Support chunked, resumable PUT/GET; SHA-256 verification; authenticated peer authorization; per-app namespace enforcement; signed durability receipts; replica health and repair.
- Tests must cover unauthorized peers, corrupted chunks, interrupted transfers, duplicate writes, peer restart, peer churn, namespace isolation, insufficient replica count, and recovery from one peer loss.
- Until the tests pass, keep the current backend as a read-only/migration source and do not claim cloud exit.

### Gate 2 — dual-read verification, no destructive dual-write
- Copy existing content to the peer mesh without changing the source.
- Compare object hashes, manifest revisions, namespace ACLs, and sampled full readbacks.
- Produce a machine-readable reconciliation report. Any mismatch blocks cutover.

### Gate 3 — opt-in canary writes
- Enable peer-backed writes for a non-critical test namespace only.
- Require the configured independent peer acknowledgements before success.
- Prove restart recovery, iPhone-to-peer transfer, peer-to-peer transfer, and operation without hosted object storage available.
- Keep rollback data untouched until the observation window and reconciliation pass.

### Gate 4 — app-by-app cutover
- Migrate one isolated app namespace at a time in this order: XShield test/security metadata, Kernelodies library metadata, PlanetApeX knowledge objects, KernelVision media manifests/artifacts, KashKorner non-sensitive records, then KoinKob coordination state. Sensitive financial data requires a separate threat model and explicit authorization before migration.
- Preserve separate keys and namespaces. Verify each app independently.
- Disable hosted writes only after evidence proves the peer mesh serves the active path. Retain the hosted read path only for a bounded rollback period.

### Gate 5 — prove independence
- Run a controlled test with hosted storage and hosted app services unavailable.
- Demonstrate authenticated peer discovery, upload, download, integrity verification, restart recovery, replica repair, and phone controls.
- Inspect network traces and storage configuration for hidden hosted dependencies.
- Publish measured capacity, durability level, reachable-peer count, recovery time, and remaining limitations.

## Acceptance criteria

A release is not “cloud-free” until all are true:
- All six canonical app namespaces are independently verified.
- A new object written from the iPhone reaches the configured number of independent peers and returns verified receipts.
- A second peer can retrieve the object by hash while the original writer is offline.
- Restart and peer-loss recovery pass without SQL, active WAL, or a single ephemeral disk.
- No private namespace is readable by a peer lacking authorization.
- Hosted object storage can be disabled in a test environment without breaking the verified path.
- Capacity numbers come from live peer measurements, not theoretical or advertised totals.
- All existing data remains preserved until explicit, separately authorized cleanup.

## Current known baseline

The repository already has local and S3-compatible remote content-addressed stores, a sovereign mesh engine, peer-replica receipt verification, and an on-device Local AI surface. The remote CAS still requires an S3-compatible endpoint and credentials; therefore it is not itself a cloud-exit implementation. The mesh engine can still select a local content-addressed store. The missing proof is a production-ready, authenticated peer-backed object data plane with tested replication and recovery across independent peers.

## Implementation status (draft branch)

The draft branch contains `src/core/apex-cbor.mjs`, `src/core/peer-content-addressed-store.mjs`, `src/core/peer-storage-libp2p-transport.mjs`, and an opt-in inbound handler in `src/core/peer-storage-runtime.mjs`. Object payloads use deterministic binary CBOR rather than JSON serialization and are AES-256-GCM encrypted before replication. The storage interface is byte-addressed (`putBytes`/`getBytes`); the runtime requires an injected peer-owned backend and has no local-filesystem fallback. SHA-256 content and peer identity receipts are verified; explicit per-app namespace ACLs are mandatory; and writes fail closed when replica count or configured independent failure-domain policy is not met. Peer addresses must terminate in their exact configured peer ID.

The legacy `/apex/sovereign/1.0.0` libp2p envelope remains newline-delimited JSON for compatibility. A parallel `/apex/sovereign/2.0.0` protocol now carries length-prefixed canonical CBOR frames over the existing Noise-encrypted, Yamux-multiplexed libp2p connection. Outbound sovereign-runtime traffic and peer object-storage transport now prefer the binary protocol. The legacy handler remains registered for existing callers, and automatic fallback to v1 is allowed only when libp2p reports protocol negotiation failure before a stream opens; timeouts, peer rejection, and ambiguous delivery failures are never replayed. The binary frame codec rejects malformed lengths, non-map envelopes, non-canonical CBOR, and payloads over the configured limit. The v2 transport is implemented in source; real multi-node interoperability and production rollout still require verification.

The legacy libp2p envelope has a 64 KiB ceiling. The peer CAS client therefore caps individual encrypted objects at 32 KiB and provides chunked binary blob upload/download using 8 KiB chunks, an encrypted manifest, and per-chunk plus whole-blob SHA-256 verification. Missing chunks fail closed rather than returning partial content. It also has an explicit repair primitive that copies a verified encrypted object from a surviving authorized peer to specified configured targets without changing the content address. These are client primitives, not yet an automatic repair controller, production media pipeline integration, or proof of multi-node durability.

The inbound peer-storage handler is disabled by default. The sovereign daemon does not yet inject a production peer-owned binary backend, so enabling the flag alone will fail closed; the app-facing production write paths are **not yet routed through the peer client**, and the current production data plane has not moved off existing providers. Latest-head CI is pending. Production peer discovery and placement, key provisioning/rotation, independent-node restart/recovery, automatic repair scheduling and garbage collection, six-app ACL provisioning, integration of chunked blobs into app media pipelines, and an end-to-end iPhone-to-peer demonstration remain blockers, not completed features. Focused tests cover replication, insufficient replicas, surviving-peer reads, tampered objects, namespace isolation, peer-address identity binding, runtime ACL checks, failure-domain policy, and oversize rejection; CI must confirm these tests actually pass.

## Immediate next implementation

Provision peer-owned durable storage and app-scoped ACLs on independent nodes, map peer identities to independently verified failure domains, then route a non-critical canary namespace through the peer transport. Add two-real-node integration tests, prove identity-to-address binding and restart recovery, and exercise peer loss/repair. Do not switch the existing remote CAS flag off in production: that could route writes to an unverified or ephemeral backend and violate the no-single-copy system-of-record rule. Keep all existing providers and data intact until the peer path is verified end to end.


## HTTP retirement boundary

HTTP is not the sovereign peer data plane. The native peer channel uses libp2p over Noise/Yamux, with a versioned binary-CBOR envelope for peer object storage. Public web pages and the current browser-facing API still use HTTP semantics over HTTPS; a browser cannot be made independent of a page-delivery/bootstrap endpoint merely by changing the peer transport. Do not claim “off HTTP” for the entire product until all app-facing data calls have a working peer/WebRTC path, browser signaling and unreachable-peer behavior are solved, and the public edge is explicitly limited to static/bootstrap delivery. No existing public API, payments, authentication, or storage route is removed in this change.

Migration runs in parallel: retain the existing API as a compatibility edge, route peer object-storage requests over v2, test v2 independently, and migrate app workflows one at a time only after real-device and two-node evidence. No SPEC gate is used as a substitute for that evidence; no release gate is disabled by this branch.
