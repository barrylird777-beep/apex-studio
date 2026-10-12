# Apex Ecosystem Independent Review Guide

## Mission
Review Apex ecosystem changes independently. Find reproducible defects before merge; do not generate noise or certify untested work.

## Canon
- Six apps: PlanetApeX, KoBlocks, KernelVision, KoinKob, KashKorner, Kernelodies.
- GardenOfApex is the Jesus Freaks / KORNS PEOPLE universe inside PlanetApeX, not a separate app.
- Preserve names, app boundaries, data, and historical capabilities.
- **Pure-WAL / Ring-WAL is the sovereign storage direction. Do not restore PostgreSQL or introduce SQL/SQLite runtime dependencies.** Legacy database code must be checked for active reachability before retirement.

## Review priority
1. Runtime correctness and production failures.
2. Authentication, peer identity, allowlists, input validation, and secret handling.
3. Pure-WAL durability: atomicity, fsync, hash-chain integrity, recovery, corruption resistance, path confinement, and concurrent writers.
4. Worker leases, retries, fencing, shutdown, and idempotent external side effects.
5. Real cross-app handoffs and authenticated peer acknowledgements.
6. iPhone controls, accessibility, and accurate network status.
7. Search provenance, deduplication, access controls, and partial-result honesty.
8. CI/CD reliability, performance, and resource leaks.

## Evidence rules
- Distinguish local runtime health from end-to-end product behavior.
- A configured public peer address is not proof of a working mesh. A server-side path is not proof of phone multipath.
- Do not claim provider-independent connectivity, global reach, unlimited access, or automatic failover without end-to-end evidence.
- Never weaken tests, security, or gates to obtain a green build.
- Preserve existing data and deployments; do not perform destructive changes as cleanup.
- King Cob is the independent final inspector; the implementer does not self-certify.
