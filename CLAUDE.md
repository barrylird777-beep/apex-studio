# Apex Ecosystem Engineering Guide

## Canonical products
The six canonical apps are PlanetApeX, KoBlocks, KernelVision, KoinKob, KashKorner, and Kernelodies. GardenOfApex is an embedded PlanetApeX universe, not a seventh app. Preserve these names and roles.

## Runtime and sovereignty
- JavaScript ES modules on Node.js 22+.
- Production API entrypoint: `server.mjs`; production stack: `npm run start:sovereign-stack`.
- Durable runtime state uses Pure-WAL/Ring-WAL under `/srv/apex/se-x`.
- Authenticated remote worker execution uses `APEX_WORKER_API_URL` and `APEX_WORKER_TOKEN`.
- Do not introduce PostgreSQL or SQLite runtime dependencies. Legacy SQL modules and migration utilities are compatibility debt to audit and retire, not the target architecture.
- A queued handoff is not proof of peer delivery. Only verified peer acknowledgements count.

## Verification
- `npm test`
- `npm run check:canonical`
- `npm run sovereign:test`
- `npm run apex:release-audit`
- `npm run smoke:production`

## Review standard
Find real defects and root causes. Preserve user data. Check authorization, idempotency, lease fencing, crash recovery, path confinement, symlink protection, atomic writes, fsync, hash-chain integrity, and deployment evidence. Do not claim a test, merge, or deployment succeeded without checking its result.
