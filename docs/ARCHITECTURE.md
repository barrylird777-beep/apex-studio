# Apex Studio 4.0 Architecture

Apex 4.0 turns the earlier foundation into a shared runtime for long-form creative projects.

## Core state
**Project → Memory → Knowledge Graph → Continuity → World State → Timeline → Production → Assets**

Each layer owns durable state and exposes small interfaces. Generated work can point back to its inputs instead of becoming an orphaned file.

## Creative intelligence
- Knowledge entities and typed relations carry provenance.
- Memory is project-scoped and searchable.
- Character DNA keeps identity, appearance, personality, relationships, and arc data together.
- World State applies explicit events and produces snapshots.
- Timelines can branch without mutating their parent.
- Assets carry parent revisions and specifications.
- The production graph models dependencies from concept to release.
- Agents are registered by capability and dispatched through an auditable job layer.

## Source discipline
Canonical/source material and creative interpretation remain separate. The ingestion boundary should preserve edition/translation, locator, source ID, and authorization metadata. Do not embed modern copyrighted translations without permission.

## Provider boundary
AI/image/audio/model integrations should be implemented as adapters. Credentials belong in environment configuration, never source control. The studio should remain useful with local/browser-native features when no external provider is configured.

## Next expansion
1. SQLite persistence adapter with migrations
2. embeddings/vector adapter
3. document extraction and chunk provenance
4. agent tool registry + permissions
5. scene/shot/camera/continuity schemas
6. collaborative project workspaces
7. background job queue
8. export/import project bundles
9. automated continuity/evaluation gates
10. richer visual graph/timeline editors
