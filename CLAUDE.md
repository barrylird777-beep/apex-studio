# Apex Studio AI Engineering Guide

## Runtime
- JavaScript ES modules on Node.js 22+.
- Express API in `server.mjs`.
- `index.mjs` runs the production daemon normally and the durable worker executor when `APEX_WORKER_ONLY=true`.
- PostgreSQL backs the durable worker queue when `DATABASE_URL` is configured.

## Commands
- `npm ci`
- `npm test`
- `npm run check`
- `npm run security:gate`
- `npm run apex:run`
- Local watch: `node --watch server.mjs`
- Local env: `node --env-file=.env server.mjs`

## Architecture
- The API enqueues durable worker tasks; it does not execute durable tasks.
- `apex-workers` claims tasks with PostgreSQL row locking and executes them.
- Worker leases are heartbeated and expired leases are reclaimed.
- Keep worker execution idempotent and safe to retry.
- `SELECT ... FOR UPDATE SKIP LOCKED` is the queue-claim pattern.
- Prefer concurrency inside a small number of Node processes over one OS process per logical worker.
- Keep production correctness in durable state, not process-local worker state.

## CI
- Pull requests use Node 22 for fast feedback.
- Main pushes retain Node 22 and 24 coverage.
- Stale CI runs are cancelled and docs-only changes are ignored.
- Preserve package-lock integrity.
- Prefer Node's built-in `node:test`.
- Prefer JSDoc plus TypeScript `--checkJs --noEmit` without a build step.

## Queue
- Batch claims when practical to reduce database round trips.
- Use bounded concurrency and exponential backoff with jitter.
- Never busy-loop against PostgreSQL.
- Heartbeat long-running tasks and reclaim expired leases.

## Change policy
- Fix root causes and add regression tests when practical.
- Never weaken tests to make CI green.
- Do not introduce paid infrastructure unless explicitly required.
