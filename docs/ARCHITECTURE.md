# Apex Studio 3.0 Architecture

Apex is organized around durable creative state rather than one-off generations.

## Layers
- **Knowledge Graph**: entities and typed relations with provenance.
- **Continuity Ledger**: persistent facts, variants, and conflict detection.
- **Timeline Engine**: canonical timelines plus branchable alternate histories.
- **Production Graph**: concept-to-release workflow and asset dependencies.
- **Agent Orchestrator**: pluggable specialist agents with auditable jobs.
- **Ingestion boundary**: source metadata, user-owned documents, extraction, normalization, provenance.
- **Asset lineage**: every generated artifact can reference its inputs, prompt/specification, model, revision, and parent asset.

## Canonical vs creative layers
Source facts should remain distinguishable from interpretation and generated fiction. A creative branch can reference canonical material without mutating the canonical dataset.

## Expansion targets
1. SQLite/Postgres persistence
2. full-text/vector retrieval
3. document extraction pipeline
4. graph UI
5. character/world schemas
6. scene/shot dependency graph
7. agent tool registry
8. evaluation and continuity gates
9. export/import bundles
10. authenticated multi-user workspaces
