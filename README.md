# Apex Ecosystem — Absolute Topology

**BLACK-PEN ARCHITECTURE**

Apex has six product surfaces sharing one universal capability plane:

- **KORNKNOB — EARS:** music, sound, audio intelligence, and capability contracts.
- **ApexStudios — EYES:** production, visual/media creation, operations, and distribution.
- **GardenOfApex — BRAIN:** scripture, research, knowledge, studies, and Korn World.
- **ApexOpportunity — MONEY:** opportunity discovery, growth, monetization, and business intelligence.
- **ApexRapidVideo — MONEY:** rapid paid video creation and fulfillment.
- **ApexAdBlocker — SHIELD:** network protection and ad blocking.

## Execution spine

Apex execution state is **not PostgreSQL and not SQLite**.

The runtime uses:

- `src/core/apex-ring-wal.mjs` — append-only JSONL WAL with hash chaining and fsync-backed commits.
- `src/core/apex-pure-store.mjs` — atomic state files and fenced durable jobs over the WAL.
- `/srv/apex/se-x/projects` — persistent project/state storage.
- Ring-buffer memory for hot task dispatch.
- Lease tokens and monotonic fencing for worker ownership.
- Replay, recovery, deduplication, retry, and dead-task handling.
- Atomic temp-file + rename commits for materialized state.

The system is decentralized by design. Multi-node coordination can be layered over the WAL; it is not described as full Raft consensus unless an actual consensus implementation and test suite prove that claim.

## Universal search

Apex exposes a general web search/fetch plane:

- `GET /api/search?q=...`
- `GET /api/fetch?url=...`
- iPhone Siri/Shortcuts includes **Search Anything**.
- Search is not restricted to Bible/project data.
- HTTPS web targets are supported.
- Provider, network, licensing, authentication, and physical-device limits still apply; Apex does not bypass them.

## AI mesh

The capability plane can route across local and external inference providers. Local inference is preferred where available. Provider quotas, billing rules, licensing, and authentication remain provider-controlled.

## Media

FFmpeg remains the mastering layer. 24 FPS is a default cinematic preset, **not a ceiling**. Output frame rate is target-dependent and can be configured for 24/30/60/120 FPS when the source, encoder, and delivery target support it. Hardware encoders are selected when available.

## iPhone

`ios/ApexMobile/` provides local GGUF inference through llama.cpp/Metal plus App Intents and Siri Shortcuts. iOS background execution is used only within Apple's supported execution model; Apex does not claim an unrestricted third-party daemon.

## Monetization

Rapid Video uses verified Stripe webhook flows and feeds paid work into the same durable WAL execution plane.

## Network protection

ApexAdBlocker provides iOS network/content protection features. iOS system-wide configuration requires the user's explicit system activation where Apple requires it.

## Development

```bash
npm install
npm start
```
