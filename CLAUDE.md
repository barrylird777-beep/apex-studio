# Apex Ecosystem Engineering Guide

## Canonical products
Exactly six canonical apps: PlanetApeX, XShield, KernelVision, KoinKob, KashKorner, and Kernelodies. KoBlocks is a reusable workflow capability, not a canonical app. GardenApex is the living universe inside PlanetApeX; GardenOfApex is historical/absorbed, not a seventh app. Preserve names, roles, data, and boundaries.

## Runtime and sovereignty
- JavaScript ES modules on Node.js 22+; production API entrypoint is `server.mjs` via `npm run start:sovereign-stack`.
- Storage target: no WAL, no local disk as the system of record, no PostgreSQL, and no persisted JSON records. Prefer authenticated remote CAS/peer-backed storage with isolated app namespaces.
- **Known implementation gap:** local and remote WAL code remains; local persistence fallback remains possible; remote CAS still serializes records/manifests as JSON. Do not claim compliance until production write paths and recovery tests prove these paths are retired.
- PostgreSQL-era modules, migrations, and old worker instructions are legacy; verify active reachability before changing or removing them. Do not run legacy PostgreSQL migration or backup commands as part of current production setup.
- The production API and sovereign runtime are separate processes supervised by `scripts/start-apex-stack.mjs`.
- Durable tasks must be idempotent, lease-safe, retry-safe, recoverable after restart, and confined to the correct app namespace.

## Verification
- Prefer focused `node --test` regression tests, then `npm test`, build checks, security checks, and production smoke/release audit when relevant.
- Validate the real runtime path, not just helper functions. Use real output artifacts and restart recovery checks where relevant.
- Peer delivery is not complete until the receiving peer acknowledges it. Do not infer phone connectivity from server health.
- Never claim multi-path, failover, or worldwide peer connectivity without end-to-end evidence.
- Search results must retain provenance and clearly report provider limitations or partial coverage.

## Change policy
- Fix root causes and add regression tests when practical.
- Preserve existing work, data, and deployments. Do not rename, delete, rebuild, or change production configuration without a verified reason and appropriate authorization.
- Never weaken tests or security checks to make CI green. Do not introduce paid infrastructure unless explicitly required.
- BLACK-PEN identifies real defects. King Cob independently inspects the result.
