# APEX ANCHOR: Peer-Owned Storage Only

Status: migration contract; not a claim that a live storage mesh currently exists.

## Non-negotiable constraints
- No PostgreSQL.
- No write-ahead log (WAL), including remote WAL probes or retry loops.
- No JSON as a persisted record, manifest, index, or storage format. JSON may be used only for transient HTTP control-plane interoperability when unavoidable; it must never be the source of truth.
- No local disk, mounted volume, or single-host filesystem as the system of record.
- No paid hosting or storage dependency.
- Keep the six canonical app namespaces isolated: PlanetApeX, XShield, KernelVision, Kernelodies, KashKorner, KoinKob.
- Fail closed when the peer network, encryption keys, or required replica count is unavailable. Never silently fall back to local storage.

## Storage model
1. Encode application payloads using the repository's canonical binary CBOR codec.
2. Encrypt payloads before transmission with authenticated encryption; keys are not stored alongside ciphertext.
3. Address immutable encrypted blocks by a cryptographic digest.
4. Send blocks only over authenticated libp2p peer sessions.
5. Require acknowledgements from the configured replica count and the configured number of independent failure domains before reporting a durable write.
6. Keep namespace ACLs explicit and deny by default.
7. Replicate and verify blocks across independent, user-controlled peers. A browser/iPhone cache may be temporary but is never a durable replica.
8. Keep the system recoverable from source code and signed binary metadata; do not depend on Railway, a vendor bucket, or a single server.

## Required migration gates
- Remove WAL imports, readiness probes, append/readback checks, retry helpers, and WAL readiness fields from the runtime path.
- Remove PostgreSQL clients, connection variables, schema/migration paths, and service dependencies.
- Audit persistence paths for JSON serialization and local filesystem writes; convert durable records to binary CBOR peer objects or remove the feature.
- Replace the daemon's local SovereignMeshEngine(storageDir) system-of-record role with a peer-backed adapter. If no peer backend is available, startup must report storage unavailable and refuse durable writes.
- Verify with automated tests that no fallback creates a local persistent store, no WAL module is loaded, no PostgreSQL client is loaded, unauthorized namespaces are rejected, ciphertext integrity is checked, and writes fail unless the durability quorum acknowledges.
- Run tests and a live two-or-more-peer round-trip before calling the network operational.

## Current limitation
The repository already contains a libp2p peer transport and encrypted content-addressed storage primitive, but the daemon still imports WAL-based readiness and a local filesystem-backed engine. This contract is not complete until those runtime dependencies are removed and the peer network passes live durability tests.
