# Apex Studio Engineering Rules

Apex Studio is a Bible Story Movie Production App. Scripture is the source of truth. Never invent Bible stories or characters. Keep the product respectful, faith-friendly, production-oriented, and **iPhone-first / mobile-responsive**. Desktop support may be useful, but a desktop must never be assumed or required for the user's development workflow.

## Operating laws

The detailed, durable rules are in [docs/DEVELOPMENT-LAWS.md](docs/DEVELOPMENT-LAWS.md). Treat them as project requirements:
- iPhone-only development environment; never assume a Mac, PC, desktop terminal, or physical keyboard.
- Free-first: assume a $0 budget unless the user says otherwise; prefer free tiers, open-source tools, and infrastructure already in use.
- Minimize typing; support voice-first and short natural-language instructions wherever practical.
- Preserve project context, approved names, architecture, requirements, and decisions in the relevant documents. Do not make the user repeat established context.
- Automate builds, checks, deployment, and verification where practical.
- Make isolated, reversible changes; preserve existing infrastructure; do not silently replace established architecture.
- Verify before claiming a change works. Never claim commands, tests, offline inference, or deployment were verified unless they actually were.
- If existing project documents conflict, flag the conflict and resolve it deliberately rather than silently choosing or overwriting a decision.
- For local/offline AI work, prove offline inference and get explicit permission before adding external model/provider network calls.

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
