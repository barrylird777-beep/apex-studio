# APEX ECOSYSTEM — MASTER ARCHITECTURE PAGE

**STATUS: BLACK-PEN LOCKED**

## 🧠 GardenOfApex — THE BRAIN

GardenOfApex owns:
- Bible research and study
- General research and knowledge
- Korn World research
- Korn World studies and analytics
- Individual Korn histories, activities, relationships, states, and timelines
- AI Chat Lab
- Research conversations and knowledge investigation
- Evidence-based answers about Garden and Korn World

The AI Chat Lab must distinguish **KNOWN, OBSERVED, INFERRED, and UNKNOWN** information and must not invent missing facts.

## 👁️ Apex Studio — THE EYES

Studio owns the user-facing creative interfaces:
- Fully capable special search engine
- Video Lab
- Imagery Lab
- Audio Lab
- AI Creation Lab

These interfaces remain in Studio even when their underlying AI capabilities come from KORN-KNOB.

### Production
Studio owns:
- movie/video direction
- story and script implementation
- scene/shot planning
- visual production
- audio production/editing
- animation
- VFX
- compositing
- editing
- mixing/mastering
- rendering
- QC
- release preparation

### Social Media Command
Studio is the:
- social media manager
- social analytics/research coordinator
- performance evaluator
- content planner
- campaign planner
- trend/opportunity researcher

**DATA → ANALYSIS → EVALUATION → OPPORTUNITIES → PLAN → PRODUCTION → RELEASE → MEASURE → LEARN**

### Studio Special Search Engine

Studio has a fully capable specialized search engine that the user can use **when desired**.

It is an optional Studio interface, not a mandatory gateway.

It can search/discover:
- AI models
- providers
- APIs
- tools
- software
- datasets
- renderers
- media capabilities
- services
- other production-relevant capabilities

It does not replace Garden research and does not replace KORN-KNOB's model/capability management.

Studio can:
1. pull knowledge/research directly from Garden when production needs it;
2. pull AI/model/media capabilities directly from KORN-KNOB when production needs them;
3. use the special search engine when the user wants broader capability discovery.

### Network & Infrastructure

Network settings and infrastructure remain owned by Studio.

Studio owns network operations, connectivity, routing, provider access, infrastructure configuration, failover, bandwidth/concurrency controls, and related production infrastructure.

## 👂 KORN-KNOB — THE EARS

KORN-KNOB owns the AI model and media capability layer for Apex overall, plus its own specialized capabilities.

It manages access to:
- LLMs
- image/vision models
- video models
- audio/music models
- voice/speech models
- multimodal models
- embedding/reranking models
- other useful AI models
- external AI providers
- local/open/commercial models
- KORN-KNOB's own models

Responsibilities:
- discovery
- registration
- routing
- selection
- fallback
- health
- versioning
- evaluation/benchmarking
- capability matching
- configuration
- provider access

KORN-KNOB also owns/discovers capabilities involving music, audio, imagery, video, voice, and other useful media AI capabilities.

**KORN-KNOB does not own the actual Studio production process. Studio borrows its capabilities.**

## 🎵 KORN-KNOB MUSIC CONCEPT

KORN-KNOB gets a persistent AI music intelligence interface/concept that goes beyond ordinary chat.

It supports:
- music discovery
- music analysis
- musical ideas
- scene-to-music reasoning
- soundtrack development
- taste intelligence
- track comparison
- musical experimentation
- long-term musical context
- music creation workflows

The permanent name remains open until designed and approved.

## MASTER RULE

**Garden researches and understands.**

**Studio directs, creates, produces, operates, and manages distribution strategy.**

**KORN-KNOB supplies and manages the AI/model/media capabilities.**

Interfaces belong to the app where the user actually needs them; underlying capabilities can be borrowed across the ecosystem.

No system becomes a monolithic “do everything” application.

### Cross-system relationship

`Studio → Garden` for knowledge/research.

`Studio → KORN-KNOB` for AI/model/media capabilities.

`Studio → Special Search Engine` when the user wants specialized discovery.

`Garden → KORN-KNOB` for AI models used by Garden's Chat Lab when needed.

KORN-KNOB supplies capabilities; it does not become the owner of Garden research or Studio production.

### Durable execution

Durable workflow state belongs in PostgreSQL. Cross-system work uses versioned contracts, provenance, idempotency, leases/fencing, and durable jobs rather than SQLite or process-local persistence.
