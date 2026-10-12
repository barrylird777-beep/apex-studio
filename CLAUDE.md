# Apex Ecosystem Engineering Guide

## Canonical products
The six canonical apps are PlanetApeX, KoBlocks, KernelVision, KoinKob, KashKorner, and Kernelodies. GardenOfApex is an embedded PlanetApeX universe, not a seventh app. Preserve these names and roles.

## Runtime and sovereignty
- JavaScript ES modules on Node.js 22+; production API entrypoint is `server.mjs` via `npm run start:sovereign-stack`.
- Durable application and worker state uses Pure-WAL / Ring-WAL. **Do not restore PostgreSQL or introduce SQL/SQLite runtime dependencies.**
- PostgreSQL-era modules, migrations, and old worker instructions are legacy; verify whether a path is active before changing or removing it.
- The production API and sovereign runtime are separate processes supervised by `scripts/start-apex-stack.mjs`.
- Durable tasks must be idempotent, lease-safe, retry-safe, recoverable after restart, and confined to the correct app namespace.

## Verification
- Prefer focused `node --test` regression tests, then `npm test`, build checks, security checks, and the production smoke/release audit when relevant.
- Validate the real runtime path, not just helper functions. Use real output artifacts and restart recovery checks where relevant.
- Peer delivery is not complete until the receiving peer acknowledges it. Do not infer phone connectivity from server health.
- Never claim multi-path, failover, or worldwide peer connectivity without end-to-end evidence.
- Search results must retain provenance and clearly report provider limitations or partial coverage.

## Change policy
- Fix root causes and add regression tests when practical.
- Preserve existing work, data, and deployments. Do not rename, delete, rebuild, or change production configuration without a verified reason and appropriate authorization.
- Never weaken tests or security checks to make CI green. Do not introduce paid infrastructure unless explicitly required.
- BLACK-PEN identifies real defects. King Cob independently inspects the result.
