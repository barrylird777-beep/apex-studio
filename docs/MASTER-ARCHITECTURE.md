# Apex Master Architecture

Version: `apex-master-architecture.v1`

## Three-system boundary

| System | Role | Owns |
|---|---|---|
| GardenOfApex | **The Brain** | Bible research, knowledge, Korn World, studies, research conversations, AI Chat Lab |
| Apex Studio | **The Eyes** | Direction, production, creative labs, editing, QC, rendering, social command, network/infrastructure |
| KORN-KNOB | **The Ears** | All Apex AI models plus its own models, model/provider discovery, routing, evaluation, and media-AI capabilities |

GardenOfApex and Apex Studio are separate systems.

## GardenOfApex

Garden researches and understands.

### AI Chat Lab
The Chat Lab is model-agnostic. It can use any KORN-KNOB-available model/provider and supports model discovery/comparison, multi-model conversations, Bible study, Korn World research, general research, saved/exportable conversations, and handoff into research.

World-state answers must distinguish:
- **KNOWN**
- **OBSERVED**
- **INFERRED**
- **UNKNOWN**

Missing world facts are never silently invented.

### Korn World Studies
Dedicated studies cover profiles, histories, daily activity, relationships, locations, state trends, timelines, social dynamics, population/world statistics, events, continuity, anomalies, and historical comparisons.

## Apex Studio

Studio directs, creates, produces, operates, and manages distribution strategy.

### Creative labs
- **Video Lab** — shots, scenes, animation, compositing, VFX, previews
- **Imagery Lab** — generation, characters, environments, storyboards, editing, continuity
- **Audio Lab** — music, narration, dialogue, voices, SFX, ambience, sound design, mixing, mastering
- **AI Creation Lab** — general multimodal experimentation and arbitrary creative workflows

Interfaces live in Studio. Underlying AI/media capabilities come from KORN-KNOB.

### Movie direction
`IDEA → DIRECTORIAL PLAN → STORY → SCRIPT → SCENES → SHOT PLAN → VISUAL DIRECTION → AUDIO DIRECTION → ASSET CREATION → EDIT → QC → RENDER → RELEASE`

Every production plan requires a compelling opening hook; the default target is a 30-second opening.

### Social Media Command
`DATA → ANALYSIS → EVALUATION → OPPORTUNITIES → PLAN → PRODUCTION → RELEASE → MEASURE → LEARN`

Studio owns planning, asset preparation, publishing workflow, performance analysis, audience behavior, retention, engagement, CTR, trends, opportunities, and learning.

### Specialized Search Engine

The **Specialized Search Engine belongs inside Apex Studio**.

It is Studio's open-ended discovery system for finding whatever production needs, including:
- AI models
- providers
- APIs
- tools
- software
- datasets
- renderers
- media capabilities
- services

It searches broadly across the available capability ecosystem and returns candidates for evaluation. KORN-KNOB remains the owner/manager of Apex AI models and media-AI capabilities; the Studio search engine discovers and requests those capabilities for Studio work.

Its operating loop is:

**SEARCH → DISCOVER → EVALUATE → AUTHORIZE → REQUEST → EXECUTE → VERIFY → RECORD**

It is not Garden's research engine and it is not KORN-KNOB's model registry. Studio owns the search experience and production-oriented discovery workflow.

### Network and infrastructure
Network ownership remains exclusively in Studio. Server telemetry must not be represented as the physical network state of a user's device.

## KORN-KNOB

KORN-KNOB owns the model/capability layer for Apex overall.

Supported classes include LLM, vision, image, video, audio, music, voice, multimodal, embedding, reranking, tools, APIs, software, datasets, and renderers.

KORN-KNOB handles discovery, registration, routing, fallback, health, versioning, evaluation/benchmarking, capability matching, and provider access.

It does **not** own Studio projects, Garden research, final Studio assembly, Studio network operations, or application business logic.

## Capability fabric

**DISCOVER → EVALUATE → AUTHORIZE → EXECUTE → VERIFY → RECORD**

"Unlimited" means open-ended extensibility, not bypassing authorization, licensing, provider controls, isolation, audit, or safety.

## Durable execution

Durable workflow state belongs in PostgreSQL. Cross-system work uses versioned contracts, provenance, idempotency, leases/fencing, and durable jobs rather than SQLite or process-local persistence.

## Canonical relationship

**GardenOfApex is the Brain. Apex Studio is the Eyes. KORN-KNOB is the Ears.**
