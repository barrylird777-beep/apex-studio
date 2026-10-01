# Apex Studio 5.0

Apex is a modular creative operating system for long-form worlds, characters, timelines, knowledge, agents, and production assets.

## Command systems
- **Oracle** — research and source-aware knowledge workflows
- **Forge** — visual generation workspace
- **Bard** — audio / narration workspace
- **Knowledge Graph** — typed entities, relations, and provenance
- **Continuity Ledger** — persistent facts and contradiction detection
- **Timeline Engine** — branchable histories and alternate continuities
- **World State** — event-driven state changes and snapshots
- **Character DNA** — identity, appearance, personality, relationships, and arc snapshots
- **Asset Lineage** — revisions, parents, specifications, and provenance
- **Memory** — project-scoped durable notes and lightweight retrieval
- **Agent Registry / Orchestrator** — specialist agents and auditable jobs
- **Production Graph** — concept through release dependency planning

## System layers
- **Universe Scale** — nested cosmic/galactic/stellar/world regions
- **Scene + Shot Model** — production-ready story and camera primitives
- **Job Queue** — long-running task boundary
- **Provider Registry** — vendor/model-agnostic AI adapter boundary
- **Tool Registry** — extensible specialist capabilities
- **Evaluation Gates** — schema, continuity, provenance, safety, and production checks
- **Import / Export** — portable studio bundles
- **Sessions** — project-aware runtime context

## API
- GET `/api/health`
- GET `/api/studio/snapshot`
- GET/POST `/api/studio/projects`
- GET/POST `/api/studio/memory`
- GET/POST `/api/studio/characters`
- POST `/api/studio/assets`

## Run
```bash
npm install
npm start
```

Apex deliberately keeps AI providers behind adapters and keeps source provenance separate from generated interpretation. Add only source text you are authorized to use.

See `docs/ARCHITECTURE.md` for the system map.
