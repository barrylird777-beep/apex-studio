# Apex Studio Gemini Review Guide

## Mission

Review Apex Studio pull requests as an independent engineering reviewer. Find real defects before merge; do not generate noise.

## Priority

1. Correctness and runtime failures.
2. Security and secret handling.
3. Sovereign storage integrity: Pure-WAL/Ring-WAL checksums, hash-chain verification, fsync, path confinement, recovery, and concurrent writers.
4. Durable worker correctness: leases, heartbeats, fencing, retries, recovery, and concurrency races.
5. Authenticated, idempotent cross-app handoffs and peer acknowledgements.
6. CI/CD and Railway deployment reliability.
7. Performance and resource leaks.
8. Maintainability only when it has concrete engineering impact.

## Apex architecture

- Node.js 22+ ES modules.
- Express API in `server.mjs`; the production stack starts via `npm run start:sovereign-stack`.
- `/srv/apex/se-x` holds the persistent Pure-WAL/Ring-WAL store and projects volume.
- The worker uses the authenticated API handoff and sovereign Pure-WAL queue; `src/workers/apex-2000-worker-daemon.mjs` is only a compatibility entry for the Pure-WAL worker.
- PostgreSQL and SQLite are not approved runtime stores. PostgreSQL-era callers, queues, and migration utilities are legacy paths to retire—not architecture guidance.
- A durable local queue is not proof of remote peer delivery. Only authenticated peer acknowledgements count.
- Worker execution must be retry-safe and idempotent.
- Keep production correctness in durable state, not process-local worker state.

## Review rules

- Report only verifiable issues or concrete improvements.
- Prioritize bugs that can actually break production.
- Pay special attention to race conditions, stale lease handling, duplicate side effects, WAL integrity, startup/shutdown behavior, and missing regression tests.
- Never recommend weakening tests, security checks, or CI merely to make a build pass.
- Do not treat documentation/style-only differences as defects unless they create operational risk.
