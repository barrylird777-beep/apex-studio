# Apex Studio Engineering Rules

Apex Studio is a Bible Story Movie Production App. Scripture is the source of truth. Never invent Bible stories or characters. Keep the product respectful, faith-friendly, production-oriented, desktop-first, and mobile-responsive.

## Locked stack
- React 18 + TypeScript + Vite
- React Router 7
- Drizzle ORM + PostgreSQL
- Node.js 22+
- Lucide icons
- shadcn/ui-compatible component patterns where useful

## Persistence
- PostgreSQL is the production persistence boundary.
- Do not introduce SQLite as a production or fallback persistence system.
- Durable worker state belongs in PostgreSQL with row locking, leases, fencing, retries, and recovery.
- Do not create a second durable queue/store for the same production workload without an explicit architectural decision.

## Execution
Work may proceed in parallel when boundaries are independent. Establish contracts at shared boundaries; do not serialize unrelated work.

## Verification
Never claim local commands ran unless actually executed. Build/test verification is required before declaring a spec complete.
