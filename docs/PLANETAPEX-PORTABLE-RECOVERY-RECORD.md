# PlanetApeX — Portable Recovery & Preservation Record

**Record purpose:** portable continuity for PlanetApeX canon, historical lineage, verified repository evidence, open conflicts, and next actions.  
**Last consolidated:** 2026-10-11  
**Evidence discipline:** confirmed canon is separated from repository facts, historical material, inference, and unknowns. This record does not claim deployment or live-service verification.

## 1. Locked product canon

- **PlanetApeX is the app and the BRAIN of the Apex universe.**
- **GardenOfApex / GardenApex is absorbed historical lineage**, not a separate current app. It represents the Jesus Freaks / KORNS PEOPLE universe and its knowledge, histories, culture, stories, research, and analytics.
- The **KORNS PEOPLE are essential living inhabitants** of the universe: their identities, stories, histories, relationships, activities, creations, and evolving records are first-class data—not merely decorative characters or dashboard entries.
- The **six apps remain separate projects** with their own code ownership and APEX ANCHOR records. PlanetApeX coordinates shared context and analytics through explicit interfaces; it does not absorb the other apps' codebases. This project is for PlanetApeX only.
- Preserve existing work. Do not rename, delete, merge, rebuild, or deploy without the appropriate authorization and verification. No public-distribution planning until requested.

### PlanetApeX has three user experience modes

1. **Universe Mode** — the living world, its people (including the KORNS PEOPLE), histories, relationships, culture, stories, knowledge, research, AI, and world activity. This is the central experience, not an optional afterthought.
2. **Bible Study Mode** — a calm, uncluttered space for Scripture and time with God. It hides the world's operational complexity from the user's view; it does not split Bible study into another app or stop necessary background work.
3. **Analytics Mode** — opens the numbers and insights when wanted, then lets the user return to the world or study experience.

### Analytics scope

Analytics is an **Apex-wide capability**, and it must also handle the large volumes of data produced by the KORNS PEOPLE. The design must support both ecosystem-wide analytics and deeper KORN-level analysis without confusing their scopes. Do not display fabricated metrics or claim a live data pipeline until verified.

### Knowledge, research, and preservation home

PlanetApeX needs a coherent, connected knowledge/archive capability for:
- general knowledge, deep research, investigations, discoveries, and research conversations;
- Bible and sacred-text library, translations/versions, language and historical context, cross-references, and theological study;
- artifacts and records: source documents, images, media, citations, notes, and recovered history;
- KORNS PEOPLE: biographies, timelines, relationships, states, activities, culture, stories, and creations;
- provenance, license/rights, source lineage, duplicate detection, and confidence/evidence labels.

Keep original sources and provenance attached to derived notes and discoveries. Distinguish **KNOWN, OBSERVED, INFERRED, UNKNOWN**. Never promote an inference into a fact or silently discard an unresolved conflict. These are capabilities inside PlanetApeX, not more apps.

## 2. Name lineage and timeline

- **Historical names/ideas:** PlanetOfApex, GardenOfApex, GardenApex, Kornworld and related labels are lineage to investigate—not automatically separate current apps.
- Earlier architecture documents and code called GardenOfApex the brain/knowledge system. This is useful historical evidence, but it is superseded by the current user-approved canon: **PlanetApeX is the brain; GardenOfApex is absorbed history and the KORNS PEOPLE universe within it.**
- Repository search found a GardenOfApex application contract and Bible Study Room integration recorded around 2026-10-07. The repo's old master architecture and README still claim a three-system model (Apex Studio, GardenOfApex, KORNKNOB), which conflicts with the current six-app product canon and must be treated as stale historical documentation until reconciled.
- The full original naming timeline, all prior decisions, and the date/order of every rename have **not** yet been recovered. Do not invent missing dates or imply this is complete history.

## 3. Repository evidence checked

Repository inspected: `barrylird777-beep/apex-studio`. This monorepo contains PlanetApeX-related and legacy ecosystem surfaces; it does **not** establish that all six apps have independent repositories.

### PlanetApeX world module
File: `src/apps/planet-apex.mjs`
- Exposes `createPlanet`, `addPlanetRegion`, `addPlanetEntity`, `planetSnapshot`, and `planetApexStatus`.
- Implements basic world/region/entity data and ID/reference validation.
- Status explicitly describes persistence as caller-owned and makes no process-local durability claim.
- This is a foundation, not proof of a complete living-world UI, integrated AI, cross-app synchronization, or durable production storage.

### Bible Study capability
File: `src/core/bible-study-room.mjs`
- Declares Scripture study, cross-references, version comparison, original-language and historical-cultural context, source provenance, notes, discoveries, and a KernelVision production-handoff capability.
- Supports evidence states KNOWN / OBSERVED / INFERRED / UNKNOWN.
- Its default store is an in-memory `Map`; durability requires a supplied persistent store.
- A status object or module contract does not prove the full interactive study experience is wired to PlanetApeX. The old `popcornCandidate` field is a naming cleanup candidate, not permission to change it silently.

### Sacred-text library
File: `src/biblical/sacred-library.mjs`
- Defines catalog families including Tanakh/Hebrew Bible, Torah, Christian Bible, Deuterocanonical books, Peshitta, Ethiopian biblical canon, Samaritan Pentateuch, Qur'an, Hadith, Bahá'í writings, Avesta, ancient Near Eastern sources, and Second Temple / early Christian texts.
- Text records include tradition, text type, title, language, edition, source, URL, license, format, publication/textual dates, and checksum.
- Explicit rule: copyrighted editions require licensed access and must not be copied into the repository without permission.
- This is catalog/record logic, not proof that all texts have been imported, licensed, or made searchable.

### Storage primitives
Files: `src/core/apex-pure-store.mjs`, `src/core/apex-ring-wal.mjs`
- Pure store uses filesystem JSON reads/writes and temp-file-plus-rename for writes under `/srv/apex/se-x/projects` by default.
- Ring-WAL appends JSONL records, reads them back, and compacts by keeping the last 10,000 records after a size threshold.
- These modules exist in source. Their production deployment, durability under crashes, concurrency safety, recovery behavior, backup/restore, scale limits, and integration with PlanetApeX have **not** been verified here. The current compaction strategy is not evidence of a complete large-scale archive design.
- The repo also contains PostgreSQL schemas/migrations and older documentation describing PostgreSQL-backed workflows. This conflicts with the user's later preference against SQL/SQLite for the modern architecture. Do not silently choose or provision a database; audit the actual consumers and decide storage boundaries deliberately.

### PlanetApeX page / persistence
- The recovery branch's `public/planet-apex.html` adds browser-local persistence using `localStorage` under `planetapex.world.v1`.
- Browser-local state is not shared/server-side durable storage and is not the final answer for the universe's large knowledge and KORN data.
- Live route response, deployed page behavior, mobile UX, and server/shared persistence are not verified.

## 4. Current GitHub work and verification

- Draft PR: https://github.com/barrylird777-beep/apex-studio/pull/296
- Branch: `apex-anchor/planetapex-canon-recovery`
- Last inspected branch commit: `a4bbc3e89b3e8e907f277b215cfa59386103d8db`
- Changes in that PR: recovery/canon documentation, PlanetApeX registry role and GardenOfApex historical alias, Bible Study Room ownership metadata, PlanetApeX page local persistence, and related tests.
- GitHub Actions for that inspected commit reported **Apex CI = success** and **SPEC-005 gate = success**.
- Passing those workflows verifies those checks only; it does not certify deployment, end-to-end product behavior, durable storage, live analytics, or complete UI integration.
- PR remains a draft and has not been merged or deployed as part of this recovery record.

## 5. Known conflicts and unknowns

1. **Stale architecture:** `src/core/apex-universe.mjs`, `README.md`, `docs/MASTER-ARCHITECTURE.md`, and tests still encode the older three-system model. At least one test expects exactly Apex Studio, GardenOfApex, and KORNKNOB. This conflicts with current canon; callers and compatibility requirements must be inspected before editing.
2. **Feature vs app boundary:** older routes/pages make GardenOfApex and Bible Study Room look like separate surfaces. Current canon requires Bible Study and Analytics to be modes/features inside PlanetApeX, while retaining useful legacy routes only if they are clearly compatible.
3. **Data durability:** Planet module state has no built-in durable store; Bible Study defaults to memory; browser localStorage is device-local. No verified end-to-end persistence path connects world state, knowledge, Bible records, artifacts, and KORN data.
4. **Analytics:** code has analytics-related utilities and old Korn-world analytics documentation, but Apex-wide + high-volume KORN analytics ingestion/storage/aggregation has not been verified end-to-end.
5. **Knowledge/research/AI:** multiple modules and interfaces exist in the repository; a complete, source-grounded PlanetApeX workflow and live provider connectivity have not been verified.
6. **Deployment:** no live PlanetApeX deployment check is recorded here.
7. **Historical recovery:** original naming timeline and all prior conversations, commits, issues, pull requests, deployment records, and artifacts have not yet been exhaustively inventoried.

## 6. Architecture principles to preserve

- One PlanetApeX with Universe, Bible Study, and Analytics modes; modes change the presentation, not product ownership or whether the world exists.
- Keep background compute details hidden during quiet Bible study while preserving necessary work and state.
- One coherent knowledge/archive model with source provenance and evidence labels.
- Analytics supports Apex-wide views and high-volume KORN-specific drill-downs.
- Use explicit, versioned inter-app interfaces, permissions, timeouts, and failure handling. No codebase merger.
- Storage must be evaluated for growth, integrity, recovery, indexing/search, deduplication, provenance, backups, and rights metadata. No false durability claims; no new database or infrastructure provisioning without approval.
- BLACK-PEN finds root causes and real defects; King Cob independently inspects; implementers do not self-certify.
- Preserve existing work and report confirmed facts, historical facts, inferences, conflicts, and unknowns separately.

## 7. Best next step

**Run a focused storage-and-data-flow audit before adding more features.** Trace the actual path for one representative record each—world/entity, KORN person/activity, Bible study note/text source, research discovery, artifact, and analytics event—from creation through persistence, retrieval, provenance, and UI. This will expose the real shared-storage gap and guide the architecture without a speculative rebuild.

## 8. Change log

- 2026-10-11: Consolidated current user-approved canon, key repository evidence, known stale architecture, CI result, and next audit step. This file is a portable continuity record; it does not modify production or authorize deployment.
