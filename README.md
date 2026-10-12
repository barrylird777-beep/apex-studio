# Apex Ecosystem — Master Architecture

**STATUS: BLACK-PEN LOCKED — ARCHITECTURAL LAW**

Apex consists of exactly three primary systems:

- **GardenOfApex:** research, knowledge, Bible, Korn World, studies, analytics, and AI Chat Lab.
- **Apex Studio:** creative production, operations, distribution strategy, network/infrastructure, and native creative interfaces.
- **KORNKNOB:** AI models, providers, routing, evaluation, and media-AI capabilities.

## Canonical application layer

The six canonical apps are application surfaces inside the Apex ecosystem, not additional Apex systems:

1. **PlanetApeX** — the world and planetary Apex environment.
2. **KoBlocks** — modular building and reusable Apex blocks.
3. **KernelVision** — finished-work viewing through KernelVision Theatre and the Kornmax cinematic display experience.
4. **KoinKob** — economy, value, barter and autonomous worker markets.
5. **KashKorner** — cash, ledger and financial state.
6. **Kernelodies** — music, sound, audio creation and audio identity.

These six names are the current product-level ownership contract. Existing implementation surfaces such as TeeVee, PayPex, KornKnob, ApexStudio, GardenOfApex and XShield remain available where their underlying capabilities are still used, but they are not the locked identities of this six-app layer.

## Apex Studio

The **Special Search Engine is part of Apex Studio**. It is a native Studio interface, not a separate system or product.

Studio owns:
- Special Search Engine
- Video Lab
- Imagery Lab
- Audio Lab
- AI Creation Lab
- Movie/video direction
- Story/script/scene/shot planning
- Visual and audio production
- Animation, VFX, compositing, editing
- Mixing/mastering
- Rendering and QC
- Release preparation
- Social Media Command
- Network and infrastructure

The Special Search Engine is **optional and user-invoked**. It can discover models, providers, APIs, tools, software, datasets, renderers, media capabilities, services, and other production-relevant capabilities.

It is **not**:
- a fourth Apex system
- an external subsystem
- a mandatory gateway
- a replacement for Garden research
- a replacement for KORNKNOB capability management

Studio can communicate directly with Garden for knowledge/research and directly with KORNKNOB for AI/model/media capabilities.

## GardenOfApex

Garden owns research and knowledge, including Bible research, Korn World research, world studies, individual histories/states/timelines, research conversations, and the AI Chat Lab.

Garden evidence must distinguish **KNOWN, OBSERVED, INFERRED, and UNKNOWN** and must not invent missing facts.

## KORNKNOB

KORNKNOB owns the AI/model/media capability layer for Apex overall and its own models/capabilities, including LLM, image, video, audio/music, voice, multimodal, embedding/reranking, provider access, routing, evaluation, health, versioning, and fallback.

KORNKNOB supplies capabilities; **Studio owns final production and assembly**.

## Production law

**Garden researches and understands.**

**Studio directs, creates, produces, operates, and manages distribution strategy.**

**KORNKNOB supplies and manages AI/model/media capabilities.**

Durable workflow state belongs in PostgreSQL rather than SQLite or process-local persistence.

## Development

```bash
npm install
npm start
```

## Canonical production surface

TeeVee is the canonical original-animation production surface inside Apex Studio. It is not a fourth Apex system.

The three systems are exactly:
- Apex Studio: production, social, network/infrastructure, and Special Search.
- Garden of Apex: knowledge, research, and creative ecosystem.
- KORNKNOB: AI/model/media/computational capability.

TeeVee production is PostgreSQL-backed and uses the durable worker system for queued execution, leases, fencing, retries, recovery, deduplication, and horizontal worker scaling.

### Application ownership

- **PlanetApeX** owns the world-level container and world-state boundary.
- **KoBlocks** owns reusable building blocks and their composition/validation.
- **KernelVision** owns finished-work viewing through KernelVision Theatre and Kornmax.
- **KoinKob** owns worker economy primitives, barter, market clearing, systemic events and adversarial economic rounds.
- **KashKorner** owns cash-ledger primitives and financial state.
- **Kernelodies** owns the music/audio application layer while reusing the existing Apex music-production and local-audio contracts.

Existing implementation systems and legacy product surfaces may remain as underlying capabilities. They do not silently replace the locked six identities.
