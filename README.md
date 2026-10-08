# Apex Ecosystem — Master Architecture

**STATUS: BLACK-PEN LOCKED — ARCHITECTURAL LAW**

Apex consists of exactly three primary systems:

- **GardenOfApex:** research, knowledge, Bible, Korn World, studies, analytics, and AI Chat Lab.
- **Apex Studio:** creative production, operations, distribution strategy, network/infrastructure, and native creative interfaces.
- **KORNKNOB:** AI models, providers, routing, evaluation, and media-AI capabilities.

## Canonical application layer

The six canonical apps are application surfaces inside those three systems, not additional Apex systems:

1. **KornKnob** — audio and music capability.
2. **TeeVee** — 24/7 television network and continuous programming.
3. **PayPex** — money-making stock, market, business and monetization intelligence.
4. **ApexStudio** — creative production, editing, mastering, QC and delivery.
5. **GardenOfApex** — knowledge, Scripture, research and creative world.
6. **XShield** — ad blocking, tracker blocking and network filtering.

These six names are the product-level ownership contract. Implementation modules may retain legacy filenames temporarily when they provide existing capability, but legacy module names are not additional apps or systems.

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

TOONX is the canonical original-animation production surface inside Apex Studio. It is not a fourth Apex system.

The three systems are exactly:
- Apex Studio: production, social, network/infrastructure, and Special Search.
- Garden of Apex: knowledge, research, and creative ecosystem.
- KORNKNOB: AI/model/media/computational capability.

TOONX production is PostgreSQL-backed and uses the durable worker system for queued execution, leases, fencing, retries, recovery, deduplication, and horizontal worker scaling.

### Application ownership

- **PayPex** owns opportunity, growth, business, stock/market and monetization intelligence. It decides what is worth pursuing and why; it does not own production execution.
- **TeeVee** owns continuous television programming and broadcast orchestration.
- **XShield** owns ad blocking, tracker blocking and network filtering.
- **ApexStudio** owns production execution, mastering, QC, delivery and infrastructure.
- **GardenOfApex** owns knowledge and research.
- **KornKnob** owns audio/music and the broader AI/model/media capability layer.

Existing implementation modules such as EngineApex, Rapid Video worker paths, RenderWorker, Forge routes, and ShieldApex may remain as implementation components while their product ownership is governed by the six-app contract. They are not additional Apex systems or canonical application identities.
