# Apex Studio Engineering Rules

Apex Studio is a Bible Story Movie Production App. Scripture is the source of truth. Never invent Bible stories or characters. Keep the product respectful, faith-friendly, production-oriented, desktop-first, and mobile-responsive.

## Locked stack
- React 18 + TypeScript + Vite
- React Router 7
- Drizzle ORM + PostgreSQL
- Node.js 22+
- Lucide icons
- shadcn/ui-compatible component patterns where useful
- FFmpeg and deterministic media tooling are first-class

## Architecture
- PostgreSQL is the durable application database. SQLite is not supported.
- Durable worker state uses PostgreSQL with leases, fencing, retries, and idempotency.
- External AI providers are interchangeable adapters, not the application's source of truth.
- Production artifacts must remain reproducible and provenance-aware.

## Execution
Implement -> test -> fix -> verify. Do not declare a feature complete without verification.

## Verification
Never claim local commands ran unless actually executed. Build/test verification is required before declaring a spec complete.
