# TOONX Production Runbook

TOONX is the 24/7 original animated entertainment network.

## Production inventory

The launch registry contains 2,785 deterministic episode slots:

- APX-0001 through APX-2785
- seven audience lanes
- durable episode state
- durable production assets
- catalog registration
- broadcast scheduling

## Production flow

IDEA -> STORY -> SCRIPT -> STORYBOARD -> VOICE -> AUDIO -> VISUAL DEVELOPMENT -> ANIMATION -> EDIT -> QC -> MASTER -> CATALOG -> SCHEDULED

The durable worker advances one stage at a time. A completed stage enqueues only its next stage, preventing the entire 2,785-episode graph from being claimed out of order.

## Real media rule

Media stages do not manufacture fake completion records.

Voice requires HF_TOKEN.
Visual development and animation require POLLINATIONS_API_KEY.
Edit and master require FFmpeg.
QC checks that required media files actually exist and contain bytes.

Text generation tries configured OpenRouter, Groq, then OpenAI credentials.

## Start production

1. Apply PostgreSQL migrations:
   npm run db:migrate:postgres

2. Seed all 2,785 episode slots and the first production wave:
   npm run toonx:bootstrap

3. Run the durable TOONX worker:
   npm run toonx:worker

The worker can be scaled horizontally. Durable leases, fencing, retries, dedupe keys, and FOR UPDATE SKIP LOCKED prevent duplicate claims.

## Output

Default production artifacts are written beneath:

./data/toonx/APX-####/

Each episode receives stage-specific artifacts and provenance records.

No episode is considered broadcast-ready merely because a database row exists. Required production media must exist and QC must pass before catalog/scheduling progression.
