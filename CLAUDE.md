# Apex Studio AI Engineering Guide

## Runtime
- JavaScript ES modules on Node.js 22+.
- Express API is served by src/api/server.ts.
- index.mjs runs the durable PostgreSQL worker executor when APEX_WORKER_ONLY=true.
- PostgreSQL backs all durable worker state.

## Commands
- npm ci
- npm test
- npm run build
- npm run db:migrate
- npm run verify:migrations

## Architecture
- The API enqueues durable worker tasks; it does not execute durable tasks.
- apex-workers claims tasks with PostgreSQL row locking and executes them.
- Worker leases are heartbeated and expired leases are reclaimed.
- Keep worker execution idempotent and safe to retry.
- SELECT ... FOR UPDATE SKIP LOCKED is the queue-claim pattern.
- Prefer concurrency inside a small number of Node processes over one OS process per logical worker.
- Keep production correctness in durable state, not process-local worker state.
- SQLite is not a production persistence layer.

## CI
- Pull requests use Node 22 for fast feedback.
- Main pushes retain Node 22 and 24 coverage.
- Stale CI runs are cancelled and docs-only changes are ignored.
- Preserve package-lock integrity.
- Prefer Node's built-in node:test.

## Queue
- Batch claims when practical to reduce database round trips.
- Use bounded concurrency and exponential backoff with jitter.
- Never busy-loop against PostgreSQL.
- Heartbeat long-running tasks and reclaim expired leases.
- Fence completion, failure, and release updates with lease ownership/token.

## Change policy
- Fix root causes and add regression tests when practical.
- Never weaken tests to make CI green.
- Do not introduce paid infrastructure unless explicitly required.
