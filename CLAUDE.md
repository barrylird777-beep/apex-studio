# Apex Studio AI Engineering Guide

## Runtime
- JavaScript ES modules on Node.js 22+.
- Express API in `server.mjs`.
- Production starts with `npm run start:sovereign-stack`.
- Durable state uses the local Pure-WAL/Ring-WAL store under `/srv/apex/se-x`.
- The production worker uses authenticated API handoffs and Pure-WAL leases; no database URL is required.

## Commands
- `npm ci`
- `npm test`
- `npm run check:canonical`
- `npm run sovereign:test`
- `npm run apex:release-audit`
- Local API: `node server.mjs`
- Sovereign production stack: `npm run start:sovereign-stack`

## Architecture
- PostgreSQL and SQLite are not approved runtime stores.
- PostgreSQL-backed queues, database callers, and migration utilities are legacy paths to retire; never reintroduce them into active runtime paths.
- The API enqueues durable work in Pure-WAL; workers claim with lease tokens and fencing, heartbeat, and recover expired leases.
- All six canonical apps keep isolated namespaces in the shared Pure-WAL fabric.
- Cross-app handoffs must be authenticated, validated, durable, idempotent, and explicitly acknowledged by the receiving peer.
- Keep process-local state separate from durable production state.
- Do not claim worldwide connectivity, multipath, or failover without end-to-end evidence.

## CI
- Pull requests use Node 22 for fast feedback.
- Main pushes retain Node 22 and 24 coverage.
- Preserve package-lock integrity.
- Prefer Node's built-in `node:test`.

## Change policy
- Fix root causes and add regression tests when practical.
- Never weaken tests to make CI green.
- Do not introduce paid infrastructure unless explicitly required.
