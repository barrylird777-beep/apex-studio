# Apex Ecosystem — Master Architecture

**STATUS: BLACK-PEN LOCKED — ARCHITECTURAL LAW**

Apex consists of exactly three primary systems:

- **GardenOfApex — THE BRAIN:** research, knowledge, Bible, Korn World, studies, analytics, and AI Chat Lab.
- **Apex Studio — THE EYES:** creative production, operations, distribution strategy, network/infrastructure, and its native creative interfaces.
- **KORN-KNOB — THE EARS:** AI models, providers, routing, evaluation, and media-AI capabilities.

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
- a replacement for KORN-KNOB capability management

Studio can communicate directly with Garden for knowledge/research and directly with KORN-KNOB for AI/model/media capabilities.

## GardenOfApex

Garden owns research and knowledge, including Bible research, Korn World research, world studies, individual histories/states/timelines, research conversations, and the AI Chat Lab.

Garden evidence must distinguish **KNOWN, OBSERVED, INFERRED, and UNKNOWN** and must not invent missing facts.

## KORN-KNOB

KORN-KNOB owns the AI/model/media capability layer for Apex overall and its own models/capabilities, including LLM, image, video, audio/music, voice, multimodal, embedding/reranking, provider access, routing, evaluation, health, versioning, and fallback.

KORN-KNOB supplies capabilities; **Studio owns final production and assembly**.

## Production law

**Garden researches and understands.**

**Studio directs, creates, produces, operates, and manages distribution strategy.**

**KORN-KNOB supplies and manages AI/model/media capabilities.**

Durable workflow state belongs in PostgreSQL rather than SQLite or process-local persistence.

## Development

```bash
npm install
npm start
```

<!-- live buyer verification -->
