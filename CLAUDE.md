# Apex Studio AI Engineering Guide

## Runtime
- JavaScript ES modules on Node.js 22+.
- The HTTP application starts with `npm start` and uses `src/api/server.ts`.
- `index.mjs` contains the durable worker executor when `APEX_WORKER_ONLY=true`.
- PostgreSQL backs durable worker state when `DATABASE_URL` is configured.

## Commands
- `npm ci`
- `npm run typecheck`
- `npm run check`
- `npm test`
- `npm run verify:migrations`
- `npm run db:migrate`
- `npm start`

## Architecture
- PostgreSQL is the production persistence boundary.
- The API enqueues durable worker tasks; durable workers claim and execute them.
- Worker leases are heartbeated and expired leases are reclaimed.
- Keep worker execution idempotent and safe to retry.
- `SELECT ... FOR UPDATE SKIP LOCKED` is the queue-claim pattern.
- Prefer concurrency inside a bounded number of Node processes over one OS process per logical worker.
- Keep production correctness in durable state, not process-local worker state.
- Do not introduce SQLite as a production or fallback persistence system.
- Do not create a second durable queue/store for the same production workload without an explicit architectural decision.

## CI
- Pull requests use Node 22 for fast feedback.
- Main pushes retain Node 22 and 24 coverage.
- Stale CI runs are cancelled and docs-only changes are ignored.
- Preserve package-lock integrity.
- Prefer Node's built-in `node:test`.

## Queue
- Batch claims when practical to reduce database round trips.
- Use bounded concurrency and exponential backoff with jitter.
- Never busy-loop against PostgreSQL.
- Heartbeat long-running tasks and reclaim expired leases.
- Every substantial queue change requires adversarial race/recovery coverage.

## Change policy
- Fix root causes and add regression tests when practical.
- Never weaken tests to make CI green.
- Do not introduce paid infrastructure unless explicitly required.
- Titan and other engineering agents produce evidence; final production authority remains with King Cob.
