# Apex AI Engineering Command Center

This directory defines the repository-side coordination contract for Apex's parallel AI engineering workforce.

## Operating loop

RECON -> DECOMPOSE -> PARALLELIZE -> BUILD -> BREAK -> VALIDATE -> INTEGRATE -> INSPECT

This is an execution model, not a requirement that every worker wait for a previous phase to finish.

## Principles

- Independent work proceeds concurrently.
- Shared architectural boundaries require explicit contracts and integration review.
- PostgreSQL is the durable persistence foundation.
- SQLite is prohibited for the production durable-worker spine.
- Speculative infrastructure is prohibited without a demonstrated requirement.
- Builders produce evidence.
- Breakers attempt to falsify builder claims.
- Validators independently test important behavior.
- Workers never self-certify production readiness.
- King Cob is the final production inspector.
- No worker may claim another worker executed work without repository evidence.

## Workstream registry

| Division | Scope |
|---|---|
| Production Spine | runtime/server integration |
| Durable Workers | queue, claim, lease, fencing, retries, DLQ |
| PostgreSQL | schema, migrations, transactions, concurrency |
| Security | auth, trust boundaries, filesystem, uploads, secrets |
| AI Mesh | providers, routing, fallback, rate limits, output validation |
| Worker Fleet | supervisors, permanent workers, overseer |
| Media | rendering, FFmpeg, assets, mastering |
| Architecture | system boundaries, state consistency, failure domains |
| API | contracts, validation, compatibility |
| QA | unit, integration, system, regression |
| Chaos | failure injection and adversarial testing |
| CI/Release | gates, reproducibility, deployment validation |
| Titan | constrained AST mutation and mutation safety |
| Integration | merge compatibility and cross-workstream validation |

## Evidence contract

Every completed work item must identify:

1. exact files/components inspected or changed
2. behavior being repaired or verified
3. tests/checks executed
4. observed results
5. remaining uncertainty or risk

A green claim without evidence is not a green claim.

## Current coordination issue

See GitHub issue #115 for the current lightning-speed engineering wave and its parallel workstream grouping.
