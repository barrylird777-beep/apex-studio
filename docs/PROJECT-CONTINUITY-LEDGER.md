# Project Continuity Ledger

**Status:** Recovery draft — preserve-first, not a complete canon archive.  
**Purpose:** Prevent future work from renaming, merging, or inventing parts of the user's vision. This document records recoverable decisions, repository evidence, and unresolved conflicts. It must not be treated as permission to fill gaps with guesses.

## Non-negotiable collaboration rules

1. **Preserve before changing.** Recall existing decisions and artifacts before proposing a new structure.
2. **Do not invent canon.** If a name, role, connection, or feature is unclear, mark it unknown and ask only when the user is ready.
3. **User corrections supersede older notes.** Never revive a deleted name or concept from older records.
4. **Separate fact from inference.** Label ideas as confirmed, historical, proposed, or unresolved.
5. **Small reversible changes.** Do not refactor, rename, merge, or remove existing work merely to make a cleaner story.
6. **Mobile first.** Design and test for iPhone Safari before desktop; do not assume a computer is available.
7. **Free-first.** No paid service, billable resource, or hardware prerequisite without explicit approval.
8. **Verify honestly.** A commit, merge, build, deployment, and working behavior on the user's iPhone are different states.
9. **Keep the user's workload low.** Use recovered records and existing artifacts; do not make the user reconstruct everything from memory.
10. **The user owns the canon.** This ledger is a safety rail, not the authority over the user's vision.

## Current user-confirmed decisions from recent conversation

- **Kernelodies** is the current music-platform name. **KORNKNOB is deleted as a name** and must not be presented as the active music product.
- **KernelVision** has been described by the user as a 24/7 cartoon-style channel creating and playing its own original shows, drawing inspiration from early-2000s Nickelodeon, Adult Swim, and Cartoon Network. It is not a theatre.
- **GardenOfApex** is the “brain of Apex universe,” not “Korn World.”
- **Apex Studio / ApexStudios** is the production app and “eyes of Apex universe,” with production tools, a special search experience, and social analytics/management.
- **PlanetofApeX**, the “NASA pack,” extra computing, command-center capabilities, and security layers are **private to the user**. They are not public features.
- Recent user context described the public releases as an ordinary video-generation offer/pack (historically $25) and **Kernelodies**. Do not expose private infrastructure in public-product descriptions.
- **Theatres are deleted.**
- **Kornmax is unresolved.** Do not invent its meaning or purpose.

## Repository architecture evidence (main branch, inspected 2026-10-10)

The repository contains locked architecture documents that are materially more developed than an app-and-character list:

- `docs/MASTER-ARCHITECTURE.md` describes the division of responsibility: Garden researches/understands; Studio directs, creates, produces, operates, and manages distribution strategy; a model/media capability layer supplies AI capabilities. It explicitly rejects a monolithic do-everything application.
- The same architecture gives Studio a full production stack: story/script, scene/shot planning, visual/audio production, animation, VFX, compositing, editing, mixing/mastering, rendering, QC, release preparation; plus social analytics, content/campaign planning, opportunity research, and an optional specialized search engine.
- `docs/APEXUS_NETWORK_CANON.md` names **Apexus** as a 24/7 original animated entertainment network, not a single-video utility. It specifies seven programming lanes: Apexus Family, Apexus Toonhouse, Apexus Action, Apex Anime, Dark Garden, Apexus After Dark, and KornSwim. It includes continuous scheduling, bumpers, station IDs, interstitials, promos, recurring characters, premieres, movies, shorts, and seasonal programming.
- `docs/APEXUS_BUYER_READINESS.md` and `docs/APEXUS_PRODUCTION_RUNBOOK.md` define **2,785 planned episode slots** (APX-0001 through APX-2785) and a production flow: idea/story/script/storyboard/voice/audio/visual development/animation/edit/QC/master/catalog/schedule. A real completion requires non-empty media artifacts, passed QC, a master, catalog registration, and schedule placement; a database row alone is not proof.
- Those documents connect ApexEngine to opportunity intelligence, the animated network to ongoing programming and audience experience, Studio to production, and Garden to world/Scripture/research knowledge.
- The repo's production docs specify durable PostgreSQL workflow state, versioned contracts, provenance, idempotency, leases/fencing, and durable jobs. Do not silently replace this architecture with SQLite or process-local state.

### Important unresolved naming conflict — do not silently pick a side

The main-branch documents currently call the 24/7 network **Apexus** and explicitly say the older ApexRapid concept is retired. Recent user conversation separately names **KernelVision** as a 24/7 original-cartoon channel and describes an ordinary public video-generation offer. The documents may be stale relative to later decisions. Keep both pieces of evidence visible and reconcile against the user's latest canon before renaming products, merging concepts, or changing code.

The main-branch architecture also contains the retired **KORN-KNOB** label for the AI/model capability layer. The user's recent correction deletes the KORNKNOB name for the music platform and establishes Kernelodies. Do not reintroduce that name into user-facing music-product descriptions. Whether any internal capability layer needs a separate name remains unresolved.

## Broader project map (incomplete)

- **WorldApex:** umbrella world/ecosystem; complete current hierarchy is not yet reconstructed.
- **GardenOfApex:** Bible study/research and AI knowledge experience; prior requirements include distinguishing known, observed, inferred, and unknown information; Bible versions, Torah/traditions, provenance/licensing, validation, and duplicate detection.
- **Apex Studio:** production-oriented app. Repository: `barrylird777-beep/apex-studio`. Previously used deployment URL: `https://apex-studio-production.up.railway.app`; URL alone is not proof of current health.
- **ApexEngine / Opportunity Engine:** opportunity intelligence and money-making product; current deployed health must be verified separately.
- **Kernelodies:** current music platform name; full current feature scope is not reconstructed here.
- **KernelVision / Apexus:** naming relationship is unresolved as documented above; do not assume they are interchangeable.
- **PlanetofApeX / NASA pack:** private owner-only systems; implementation details are intentionally not published here.

This is not a complete product specification. Do not fill missing pieces by guessing.

## Recovery workflow

1. **Recall** relevant recent conversation records, repository docs, issues, commits, and deployed state.
2. **Scope** only the immediate request.
3. **Preserve** a copy of the current state before editing.
4. **Implement** the smallest reversible change.
5. **Verify** build, checks, deployment, and mobile behavior separately.
6. **Report** what changed, what was verified, and what remains unknown.

## Change log

- Initial recovery draft created.
- Updated after inspecting the repository's locked master architecture, Apexus network canon, buyer-readiness requirements, and production runbook. Naming conflicts are explicitly recorded instead of being guessed away.
