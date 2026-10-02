# Free-first architecture

Apex stays usable locally without a paid platform.

## Local mode

- Express serves the PWA and API.
- JSON persistence stores creative state under `data/runtime/`.
- External AI providers are disabled by default.
- Provider integrations are adapters, not required dependencies.
- FFmpeg can be added locally for final rendering without changing the creative data model.

## Optional hosted mode

When the project needs accounts, collaboration, durable cloud storage, or edge delivery, the architecture can add Supabase Free for Postgres/auth/storage/realtime and Cloudflare Workers for a thin edge/API layer. A local or self-hosted render worker can handle FFmpeg-heavy work.

Current free-tier limits should be checked against the providers before deployment; they can change over time.

## AI provider boundary

Text, image, and audio generation flow through provider adapters. Apex owns prompt inputs, Scripture provenance, character/location continuity, generated asset lineage, review state, and final assembly. A provider only supplies an output.

## Mobile

The PWA is the first client. A future Expo client can reuse the same `/api/studio` contracts without changing the creative model.
