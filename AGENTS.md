# Apex Studio Engineering Rules

Apex Studio is a Bible Story Movie Production App. Scripture is the source of truth. Never invent Bible stories or characters. Keep the product respectful, faith-friendly, production-oriented, desktop-first, and mobile-responsive.

## Locked stack
- React 18 + TypeScript + Vite
- React Router 7
- Drizzle ORM + better-sqlite3 + SQLite
- Node.js 22+
- Lucide icons
- shadcn/ui-compatible component patterns where useful

## Execution
SPEC-001 -> implement -> test -> fix -> verify -> SPEC-002. Do not implement future specs while the current spec is incomplete.

## SPEC-001 scope
Only project dashboard: project list, create/edit/delete, project overview counts, next shoot day, SQLite persistence, and empty state. No scene management, character management, call sheets, budget UI, or other specs.

## Verification
Never claim local commands ran unless actually executed. Build/test verification is required before declaring a spec complete.