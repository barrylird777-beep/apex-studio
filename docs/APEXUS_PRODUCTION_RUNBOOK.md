# Apexus Production Runbook

Apexus is a historical production-network capability being carried forward under the six canonical apps. Production and release capabilities belong under KernelVision; shared research and living-universe knowledge belongs under PlanetApeX. Apexus is not a seventh app.

## Production inventory

The launch registry historically described 2,785 deterministic episode slots:
- APX-0001 through APX-2785
- seven audience lanes
- episode state and production assets
- catalog registration and broadcast scheduling

Treat this as a planned inventory, not proof that all episodes or workers are currently running.

## Production flow

IDEA -> STORY -> SCRIPT -> STORYBOARD -> VOICE -> AUDIO -> VISUAL DEVELOPMENT -> ANIMATION -> EDIT -> QC -> MASTER -> CATALOG -> SCHEDULED

A durable worker should advance one stage at a time. A completed stage should enqueue only its next stage, preventing out-of-order claims.

## Real media rule

Media stages must not manufacture fake completion records.
- Voice requires a configured provider credential.
- Visual development and animation require a configured provider credential.
- Edit and master require FFmpeg.
- QC must verify required media artifacts actually exist and contain bytes.
- Text generation requires a configured supported provider.

## Start production

**Do not use the retired PostgreSQL setup flow below.** The active sovereign storage implementation is still under remediation; verify the actual persistence backend and readiness before enabling production workers. Do not start workers against an unverified or local-fallback store.

The prior PostgreSQL migrations, bootstrap commands, and local `./data/apexus` output instructions are legacy documentation, not an approved current deployment procedure.

## Output and release

No episode is broadcast-ready merely because a task or database record exists. Required production media must exist, source provenance must be retained, and quality control must pass before catalog/scheduling progression.
