# Apex Ecosystem Independent Review Guide

## Mission
Inspect all six canonical apps and shared infrastructure for real defects, security failures, data-loss risks, and false-success behavior.

## Canonical products
PlanetApeX, KoBlocks, KernelVision, KoinKob, KashKorner, Kernelodies. GardenOfApex is embedded in PlanetApeX, not a seventh app. Preserve names and roles.

## Architecture
- Production API: `server.mjs`; production stack: `npm run start:sovereign-stack`.
- Durable state: Pure-WAL/Ring-WAL, with isolated namespaces per canonical app.
- Remote workers use authenticated API handoffs and Pure-WAL leases.
- Do not restore PostgreSQL or introduce SQL/SQLite runtime dependencies. Legacy SQL modules and migration utilities are compatibility debt until retired.
- A durable queued dispatch is not proof of remote peer delivery; require a verified peer acknowledgement.

## Review priorities
1. Correctness and production runtime failures.
2. Authentication, authorization, and secret handling.
3. WAL integrity, fsync, recovery, path confinement, and concurrent writers.
4. Worker leases, heartbeats, fencing, retries, and idempotency.
5. Cross-app handoff correctness and peer acknowledgements.
6. CI/CD and deployment verification.
7. Resource usage and performance.

Report only evidence-backed findings. Never weaken tests or claim unverified behavior is working.
