# Apex Studio Gemini Review Guide

## Mission

Review Apex Studio pull requests as an independent engineering reviewer. Find real defects before merge; do not generate noise.

## Priority

1. Correctness and runtime failures.
2. Security and secret handling.
3. Durable worker correctness: leases, heartbeats, fencing, retries, recovery, and concurrency races.
4. PostgreSQL correctness and transaction safety.
5. External side-effect idempotency and duplicate execution risks.
6. CI/CD and Railway deployment reliability.
7. Performance and resource leaks.
8. Maintainability only when it has concrete engineering impact.

## Apex architecture

- Node.js 22+ ES modules.
- Express API in `server.mjs`.
- `index.mjs` runs the production daemon or, with `APEX_WORKER_ONLY=true`, the durable worker executor.
- PostgreSQL is the durable queue when `DATABASE_URL` is configured.
- API processes enqueue durable work; `apex-workers` claims and executes it.
- Queue claiming uses PostgreSQL row locking with `FOR UPDATE SKIP LOCKED`.
- Worker leases are heartbeated and expired leases are reclaimed.
- Worker execution must be retry-safe and idempotent.
- Keep process-local worker state separate from durable production state.

## Review rules

- Report only verifiable issues or concrete improvements.
- Prioritize bugs that can actually break production.
- Pay special attention to race conditions, stale lease handling, duplicate side effects, schema initialization, startup/shutdown behavior, and missing regression tests.
- Never recommend weakening tests, security checks, or CI merely to make a build pass.
- Do not treat documentation/style-only differences as defects unless they create operational risk.
