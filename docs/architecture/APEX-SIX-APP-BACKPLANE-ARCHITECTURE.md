# APEX Six-App Backplane Architecture

**Status:** Canonical architecture direction; implementation and production readiness must be verified component by component.
**Scope:** The six canonical APEX apps and their backend-only infrastructure. This document extends, and does not replace, the six app identities in `MASTER-ARCHITECTURE.md`.

## Founding design principle

Each app keeps its recognizable, approachable civilian-facing product experience. Behind that interface, each app gains the specialized infrastructure needed to operate as a serious, scalable, commercially useful part of the APEX universe.

The frontend should remain understandable, responsive, accessible, and focused on the app's purpose. The backplane carries the complex operations: durable data, identity and policy enforcement, orchestration, analytics, workflow execution, model/tool routing, capacity management, monetization, recovery, and inter-app coordination.

"Backend-only" means infrastructure complexity does not burden ordinary users or leak internal implementation details into the UI. It does **not** mean concealing material data practices, security incidents, pricing, consent requests, or consequential automated decisions. Those must remain transparent and controllable.

No system is assumed perfect. Each capability requires defined failure behavior, observability, bounded resource use, tests, rollback, and evidence before being marked verified.

## Non-negotiable architecture rules

1. Preserve the six canonical identities and their founding purposes. Do not create a seventh app to house shared capabilities.
2. Give every app a separate identity, namespace, authorization policy, secrets, encryption-key scope, data-product boundary, and release evidence. Shared infrastructure does not imply shared data access.
3. Use least privilege and explicit, auditable capability grants for every cross-app handoff. The receiver validates sender identity, payload schema, purpose, replay/idempotency key, and permissions before accepting work.
4. No app may silently elevate its privileges, bypass another app's policy, or turn a queued message into a claimed delivery without a verified receiver acknowledgement.
5. The user-facing experience stays simple; the user retains meaningful control over permissions, sharing, paid actions, retention, exports, and consequential automation.
6. Preserve data before migrations or cleanup. No destructive migration, local-store retirement, or fallback removal until the destination passes parity, restore, restart, interruption, and rollback tests.
7. A design document, passing unit test, readiness probe, or successful deploy is not proof of production correctness. Tie each claim to a specific build, test evidence, and runtime observation.
8. Every backend service has an owner, purpose, data classification, trust boundary, dependency map, resource budget, SLO, recovery objective, and deprecation plan.
9. Apply privacy by design: minimize collection, document provenance and rights, scope data use to authorized purposes, prevent cross-tenant retrieval, and never enable customer-data model training or resale by default.
10. Keep commercial growth aligned with reliability and trust: meter fairly, show terms before paid actions, enforce server-side entitlements, and reconcile usage against auditable records.

## Shared APEX backplane

These are shared platform capabilities, not a seventh app. Shared services must enforce per-app boundaries at every request and storage operation.

### Identity and policy plane
- Per-app service identities and scoped credentials; short-lived credentials where supported; rotation and revocation.
- Tenant- and namespace-aware authorization at ingress, retrieval, storage, tool execution, export, and data egress.
- A policy decision interface that distinguishes hard legal/security constraints from configurable user choices and ordinary recommendations.
- Tamper-evident audit events for privileged actions, permission changes, cross-app handoffs, exports, data egress, and high-impact automation.
- No hidden master credential or undocumented bypass.

### Data and knowledge plane
- A catalog of datasets, objects, schemas, lineage, source rights, quality, freshness, sensitivity, owner/tenant, permitted purposes, retention, and export status.
- Content-addressed immutable objects where appropriate, versioned mutable references, integrity manifests, resumable transfer, and independent replica receipts.
- A portable export/import format with stable IDs, schemas, timestamps, provenance, and checksums.
- Verified backups/restores and explicit RPO/RTO; backups are not considered valid until isolated restore tests pass.
- Search and embeddings must enforce source permissions at query time. Deletion and retention cover primary stores, indexes, caches, replicas, and backup expiry, with limitations disclosed accurately.
- No storage-system replacement is complete until production writes, restart recovery, peer loss, interrupted migration, and rollback have been tested against real independent failure domains.

### Execution and orchestration plane
- Durable, idempotent job envelopes with actor, tenant, app namespace, purpose, input references, resource budget, deadline, retry policy, and result receipt.
- Bounded retries, dead-letter/quarantine handling, cancellation, lease fencing, deduplication, and recovery after worker restarts.
- Separate queues and quotas for interactive requests, batch work, paid customer jobs, internal maintenance, and model inference.
- Admission control, backpressure, fair scheduling, tenant quotas, cost ceilings, and overload behavior that preserves correctness.
- Tools and retrieved content are untrusted input; no tool output can grant new permissions or override policy.

### Intelligence and integration plane
- Model/provider routing by capability, privacy mode, latency, cost, and quality; fall back only to an explicitly allowed provider and report degraded behavior.
- Data-minimized requests, provider retention/training controls, secret redaction, output validation, and auditable external data egress.
- Versioned inter-app contracts, schema compatibility, authenticated events, replay protection, and trace IDs across workflows.
- Federated search over authorized sources, with source attribution, timestamps, freshness, and explicit partial-result indicators.

### Commercial and operational plane
- Server-side entitlements, metering, pricing versions, idempotent payment fulfillment, fraud/abuse limits, and reconciliation between usage and billing.
- Separate customer data from operational telemetry and billing metadata; use minimal telemetry and documented retention.
- Per-app dashboards for latency, errors, queue depth, cost, capacity, data integrity, authorization denials, replication health, and recovery status.
- Deployment provenance, signed/reproducible artifacts where feasible, dependency and secret scanning, staged releases, rollback, incident response, and change approval.
- Capacity reports must derive from authenticated, currently reachable resources and distinguish allocated, usable, reserved, and recoverable capacity. Never report theoretical capacity as available capacity.

## Six app-specific backplanes

### 1. PlanetApeX — brain
**Founding purpose:** Bible study, research, knowledge, AI, world/universe analytics, and interactive experiences. GardenApex remains the living Jesus Freaks / KORNS PEOPLE universe inside PlanetApeX.

**Backend systems**
- Research federation and source-ingestion pipeline with provenance, timestamps, rights/terms, deduplication, freshness, and source reliability labels.
- Knowledge graph and versioned content catalog with explicit distinctions among KNOWN, OBSERVED, INFERRED, and UNKNOWN.
- Retrieval pipeline with tenant-aware access checks, citation/source traceability, prompt-injection isolation, and sensitive-source filtering.
- Analytics and simulation jobs isolated from production customer data unless explicitly authorized.
- AI routing, evaluation, and quality feedback with privacy-preserving telemetry and a hard boundary between user-provided canon and generated/reconstructed material.
- GardenApex universe data and media retain their own scoped namespaces and locked canon/version history.

**Frontend promise:** a clear research and knowledge experience with visible sources and uncertainty; the infrastructure remains behind the interface.

### 2. XShield — shield
**Founding purpose:** security and privacy, ad/tracker blocking, DNS protection, content filtering, and protected connectivity.

**Backend systems**
- Policy distribution and signed rule updates, versioned blocklists/allowlists, safe rollback, and false-positive review.
- DNS and network-path diagnostics based on measured client behavior, with no claim of device-wide protection where the platform does not grant it.
- Threat-intelligence ingestion with provenance, expiry, confidence, and abuse-resistant update validation.
- Privacy-preserving telemetry, local-first decisions where feasible, explicit permissions, and minimal retention.
- Secure update pipeline, device/session revocation, policy conflict resolution, and incident containment.
- Isolation between threat-analysis data and customer browsing/content data.

**Frontend promise:** understandable protection status, meaningful controls, and honest explanations of what is and is not protected.

### 3. KernelVision — eyes
**Founding purpose:** creative production and delivery across direction, scripts, scenes, images, video, animation, VFX, editing, mixing/mastering, rendering, QC, publishing, Special Search, and social/manager analytics.

**Backend systems**
- Durable media asset catalog with content hashes, version history, lineage, licenses, releases, and rights/consent metadata.
- Render and media-processing queue with GPU/CPU admission control, resource reservations, progress events, cancellation, checkpoint/retry, and artifact verification.
- Creative pipeline graph for scripts, scenes, source assets, edit decisions, renders, QC results, approvals, and published outputs.
- Media QC and validation: codec/format integrity, audio/video synchronization, missing assets, resolution, and configured acceptance checks.
- Publishing connectors with per-platform permissions, approval gates, credential isolation, idempotent uploads, and reconciled publication receipts.
- Special Search discovery backend with source provenance, authorized indexing, deduplication, freshness, and provider-specific limits.
- Social/manager analytics with platform terms and user authorization enforced; no unauthorized scraping or covert account access.

**Frontend promise:** approachable creation tools; heavy rendering, orchestration, QC, and delivery remain background services with clear status and cost controls.

### 4. KoinKob — autonomous economy
**Founding purpose:** worker accounts, asset markets, market clearing and settlement, systemic events, adversarial rounds, and the 2,000-worker simulation.

**Backend systems**
- Deterministic simulation engine with versioned rules, seeded/reproducible runs, event logs, scenario isolation, and reproducible result artifacts.
- Ledger-like state transitions with idempotent operations, invariant checks, transaction boundaries, and explicit reconciliation.
- Worker identity and capability registry; sandboxed job execution with resource limits and adversarial-input handling.
- Market clearing and settlement simulation separated from any real-money/payment path unless a distinct, reviewed authorization and compliance design permits it.
- Economic metrics, stress scenarios, fairness/robustness evaluation, and replayable audit traces.
- Strong boundary between simulated assets/currency and real customer funds; no UI or API may blur the distinction.

**Frontend promise:** transparent simulations and economic experiments, with assumptions, scenarios, and outcomes understandable to users.

### 5. KashKorner — money/connectivity
**Founding purpose:** cash flow, ledger and financial state, monetization, and connectivity coordination; preserve relevant EngineApex/Apexus capabilities without adding app identities.

**Backend systems**
- Append-only or otherwise auditable financial event model with reconciled balances, idempotency keys, and explicit correction/reversal records.
- Billing/metering service with versioned prices, usage evidence, quotas, credits/refunds, and payment-provider webhook verification.
- Secret isolation for payment/connectivity providers; no payment secrets in browser bundles, logs, prompts, or app-to-app payloads.
- Cash-flow forecasts with clear separation of observed transactions, assumptions, and projections.
- Connectivity coordination using measured path quality, policy constraints, availability, and explicit user permissions; never infer global connectivity from server health.
- Fraud/abuse monitoring with bounded automated actions and a review/appeal path for consequential account restrictions.
- Customer-facing export and reconciliation workflows; no silent alteration of historical financial records.

**Frontend promise:** clear money state, transparent prices, auditable history, and explicit consent for paid or connectivity-affecting actions.

### 6. Kernelodies — ears
**Founding purpose:** music, sound, audio creation, discovery, and audio identity. Jesus Freaks / KORNS PEOPLE music follows the locked 432 Hz rule.

**Backend systems**
- Audio asset catalog with waveform/metadata indexing, source provenance, rights, contributor credits, and version history.
- Audio processing pipeline for creation, discovery, mastering, format conversion, loudness checks, and artifact validation.
- Music identity and discovery models with evaluation, explainable matches, opt-in personalization, and controls for data retention.
- Rights-aware similarity/search and distribution checks; do not treat technical availability as permission to use or sell a recording.
- The 432 Hz canon requirement is validated in relevant creation/delivery paths without silently rewriting source masters.
- Isolated processing jobs, bounded compute, reproducible outputs, and auditable publishing/fulfillment receipts.

**Frontend promise:** intuitive music and sound experiences; heavy analysis and processing run behind the scenes while rights, attribution, and canon remain preserved.

## Cross-app workflow contract

1. A user or authorized automation initiates a named workflow with a declared purpose.
2. The orchestrator identifies each participating app, data scope, required permissions, cost/resource budget, and failure policy.
3. Each app receives only the minimum input references and capabilities it needs.
4. Each receiving app authenticates the sender, validates schema and purpose, checks current authorization, and deduplicates the operation.
5. Each stage emits a signed or otherwise verifiable result/receipt and trace ID. A queue acknowledgement is not completion.
6. The orchestrator records partial completion and compensation/retry options. It must not report overall success if required stages failed.
7. User-visible status remains concise and accurate; consequential failures, costs, external sharing, and irreversible actions are disclosed.

## Release and verification gates

A capability is marked VERIFIED only when the evidence matches the claim and the exact release:
- Unit and adversarial tests, including denial cases and cross-tenant boundary tests.
- Integration tests for the real call path and actual adapters, not only mocks.
- Restart, interruption, retry, cancellation, quota exhaustion, and dependency-loss tests.
- Data export/import and isolated restore tests with hashes and application-level read-back.
- Real peer or provider evidence for claims about durability, independent failure domains, and production capacity.
- Deployment identity, deployed commit SHA, health/smoke checks, error and authorization telemetry, and rollback readiness.
- Independent review of high-impact security, storage, financial, and privacy changes.
- Known gaps, unsupported claims, and operational dependencies recorded in the release artifact.

**Definition of done:** the frontend remains approachable; each app's specialized backplane is connected to its live paths; shared operations are authenticated and recoverable; data and money are auditable; costs and failures are bounded; user choices remain respected; and each production claim has independently checkable evidence. This is a target, not a claim that all six backplanes are already complete.
