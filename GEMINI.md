# Apex Ecosystem Independent Review Guide

## Mission
Review Apex ecosystem changes independently. Find reproducible defects before merge; do not generate noise or certify untested work.

## Canon
- Exactly six canonical apps: PlanetApeX, XShield, KernelVision, KoinKob, KashKorner, Kernelodies. KoBlocks is a reusable workflow capability, not a canonical app.
- GardenApex is the living Jesus Freaks / KORNS PEOPLE universe inside PlanetApeX. GardenOfApex is historical/absorbed, not a seventh app.
- Preserve names, app boundaries, data, and historical capabilities.
- Storage target: no WAL, no local disk as the system of record, no PostgreSQL, and no persisted JSON records. Prefer authenticated remote CAS/peer-backed storage with per-app isolation. Existing local/remote WAL and JSON-backed CAS code remains legacy implementation until removed and tested; do not claim the target is complete merely because a readiness probe passes.

## Review priority
1. Runtime correctness and production failures.
2. Authentication, peer identity, allowlists, input validation, and secret handling.
3. Removal of WAL and local-persistence fallbacks; non-JSON persistence; remote durability, integrity, and recovery.
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
