# Apex Repository Baseline and Storage Release Gate

**Status: BLOCKED / UNVERIFIED.** This is a code-review baseline, not proof of deployed behavior. The locked AYE•YAE canon takes precedence over legacy implementation choices.

## Canonical product identity

The six app identities are exactly:

1. PlanetApeX — knowledge and universe
2. XShield — security and privacy
3. KernelVision — creative production
4. KoinKob — autonomous economy
5. KashKorner — money and connectivity
6. Kernelodies — music and audio

GardenApex is a living universe inside PlanetApeX, not a seventh app. Historical names and capabilities must remain clearly labeled as lineage; they do not create replacement app identities.

## Locked persistence constraints

The sovereign system of record must not be PostgreSQL, SQLite/SQL, a local filesystem, a WAL/append log, or persisted JSON records. Do not route production writes to these systems as a fallback. Existing code and migration scripts are legacy evidence until each path is proven inactive or safely migrated.

## Repository findings from static source review

The repository currently contains the following known blockers:

- `src/core/storage.mjs` writes a local `manifest.json` and asset files.
- `src/core/apex-pure-store.mjs` composes local CAS/WAL components and remote adapters; its exact production routing must be tested, not inferred from filenames.
- `src/core/remote-apex-ring-wal.mjs` implements an append-only WAL on top of remote CAS.
- `src/core/remote-content-addressed-store.mjs` serializes records/manifests as JSON objects for an S3-compatible backend.
- `package.json` still exposes Drizzle/SQL/PostgreSQL dependencies and migration/backup scripts. Their presence does not establish that the live runtime uses them, but they conflict with a clean sovereign baseline and must not be wired into production persistence.
- The current CI includes WAL and local-CAS tests. Passing those tests proves regression behavior for those components, not compliance with the locked sovereign storage design.

## Required target architecture

Production writes must route through an authenticated peer-owned binary storage API with explicit app namespaces, content-addressed integrity, authorization checks, and verifiable durability receipts. No hidden fallback to local disk, SQL, WAL, or JSON manifests is permitted.

## Release gate — all items required

1. Identify each production write/read entry point and map it to its active adapter.
2. Verify authenticated peer identities and independent operator/failure domains.
3. Write data through the live peer API and independently read it back.
4. Restart peers and prove data survives.
5. Remove one peer; read from surviving replicas and repair the missing replica.
6. Prove isolation and authorization across all six app namespaces.
7. Verify receipts, integrity checks, and the configured commit/quorum protocol.
8. Independently read back the deployed configuration and run the complete relevant test suite.

Until these checks pass on independently controlled physical peers, the release status stays **BLOCKED / UNVERIFIED**. Unit tests, in-memory fixtures, a benchmark, a CI pass, or a running hosting service are not substitutes for physical-peer durability evidence.

## Change-control rules

- Preserve original data and history.
- Do not silently delete legacy paths; first prove migration and recovery.
- Never describe a target design as implemented merely because an adapter exists.
- Record the exact commit, tests, and read-back evidence for every verification claim.
