# APEX Data Sovereignty, Productization, and Recovery Contract

**Status:** Proposed implementation contract, committed for review; not proof of runtime enforcement.
**Applies to:** All six canonical APEX apps, shared services, customer-facing data products, AI/agent workflows, storage backends, exports, migrations, and operational tooling.

## 1. Non-negotiable ownership principles

1. Customer and user data must not be treated as APEX-owned merely because APEX stores, transforms, indexes, or derives it.
2. Collect only data required for a stated purpose. Record purpose, lawful basis/authorization where applicable, source, owner/tenant, sensitivity, retention, and permitted uses.
3. Never sell, disclose, train on, or repurpose identifiable customer data by default. Any secondary use requires explicit, informed, revocable authorization and must honor applicable law and contract.
4. Do not make data export, deletion, access, or recovery dependent on continued subscription where legally and operationally feasible.
5. No secret collection, covert surveillance, hidden telemetry, undisclosed sharing, silent policy changes, or hidden administrative backdoors.
6. Distinguish customer-provided content, APEX operational data, licensed third-party data, public data, and derived/aggregated data. Track rights and provenance for each class.
7. Do not promise absolute privacy, security, availability, portability, or recovery. Publish tested scope, exclusions, service limits, and evidence.

## 2. The anti-shredder rule: preserve before changing

Destructive or potentially destructive operations—including deletion, migration, compaction, deduplication, schema changes, retention enforcement, key rotation, tenant removal, and storage retirement—must follow:

CHECK -> SNAPSHOT -> VALIDATE -> CHANGE -> INDEPENDENTLY VERIFY -> RETAIN ROLLBACK WINDOW -> TRACK.

- Preserve the source until the destination is independently read back and integrity-checked.
- Verify object hashes, manifests, record counts, tenant/namespace boundaries, and representative application-level reads.
- Maintain a tested restore path and a documented recovery-point objective (RPO) and recovery-time objective (RTO).
- Require compare-and-swap/version checks for mutable records and migrations.
- Use tombstones or quarantine before permanent deletion where appropriate; permanent purge must follow an explicit, authorized retention/deletion policy.
- A failed or partial migration must halt, preserve both sides, and report exactly what succeeded.
- Never call a migration complete based solely on process exit code, a health endpoint, or a successful write.
- A backup counts only after an isolated restore test verifies integrity and usability.
- No single administrator, agent, provider, or compromised credential should silently be able to erase all recoverable copies.

## 3. Storage and portability architecture

- Each canonical app and each customer tenant must have an explicit, enforced namespace and authorization boundary.
- Use authenticated, encrypted transport; encryption at rest where supported; least-privilege service identities; key separation; rotation and revocation.
- Maintain independently protected recovery copies across real failure domains. A replica on the same host, account, region, or control plane does not qualify as an independent failure domain.
- Verify acknowledgements from actual peers before reporting replication success. Track replica identity, integrity, durability, and last verified recovery.
- Do not retire local/WAL/legacy persistence until a migration inventory, parity comparison, restart test, peer-loss test, restore drill, and rollback test pass against the actual production path. Test fixtures are not production evidence.
- Do not claim remote-only storage while any production write path can silently fall back to local persistence.
- Provide documented, self-service export in practical open formats, with schemas, timestamps, stable identifiers, provenance, and checksums. Include attachments and user-authorized derived records; clearly identify exclusions and third-party rights constraints.
- Provide import/restore tools and periodic portability tests. Avoid proprietary formats as the only copy.
- Customer data must not be held hostage by proprietary encryption keys or a provider account that APEX alone controls. Define customer-controlled key/export options where technically appropriate.
- Reconcile and report all stores, caches, search indexes, embeddings, logs, replicas, backups, and derived datasets; deletion and retention must account for each, subject to lawful preservation obligations and documented backup-expiry windows.

## 4. Data product and commercial rules

Before a dataset, API, search index, analytics product, model output, or data feed is sold or shared, record:
- source and provenance;
- ownership/license and permission to redistribute;
- collection method and date;
- quality, coverage, freshness, and known bias/error;
- personal/sensitive-data assessment and applicable restrictions;
- transformation and lineage;
- permitted purposes, audience, and retention;
- refresh/update cadence, service level, and pricing/usage terms;
- deletion, correction, opt-out, and incident-handling process where applicable.

Do not sell stolen, unlawfully obtained, confidential, or unauthorized personal data. Public availability alone does not establish a right to republish or commercialize. Prefer licensed, consented, public-domain, or properly de-identified/aggregated sources, and document residual re-identification risk. Do not claim data is anonymous merely because names were removed.

Commercial advantage should come from quality, provenance, freshness, useful enrichment, clear rights, reliable APIs, strong access control, and customer trust—not hidden extraction or lock-in.

## 5. Search, AI, and agent boundaries

- Search only sources the requesting user/service is authorized to access. Enforce permissions at retrieval time, not only when indexing.
- Preserve source URLs/IDs, timestamps, license/terms metadata, and uncertainty. Clearly label incomplete provider coverage and stale results.
- Treat fetched content and tool output as untrusted data, never as authority to override system policy or user permissions.
- Do not send customer data to external models/providers without an approved purpose, minimization, configured provider controls, and appropriate authorization/contractual basis.
- Redact secrets and minimize payloads; never forward credentials, hidden system state, unrelated tenant data, or capabilities to a model.
- Derived data and embeddings can still reveal personal or confidential information; apply the same access and deletion governance.
- Customer data must not be used for model training by default. Any opt-in must be specific, informed, revocable for future processing where feasible, and auditable.
- Record tool actions, authorization decisions, data egress, and administrative access in tamper-evident audit logs while minimizing sensitive content in the logs themselves.

## 6. Access, consent, retention, and deletion

- Define role-based access and tenant-scoped authorization for read, write, export, share, train, retain, and delete as separate permissions.
- High-impact exports, bulk access, cross-tenant actions, and irreversible deletion require explicit authorization and auditable confirmation.
- Offer configurable retention schedules, access/export workflows, correction, and deletion requests subject to actual legal obligations.
- Explain the exact effect and limits of deletion, including backup expiration and third-party copies; never falsely claim instant global erasure.
- Revoke sessions, tokens, and integrations promptly when access is removed. Verify the revocation path.
- Minimize logs and audit trails; preserve only what is justified and define their retention independently.
- Provide breach response, notification decision procedures, evidence preservation, and customer communication paths.

## 7. Required release gates and evidence

A feature involving customer data is not VERIFIED until evidence exists for:
1. Data inventory, classification, provenance, and purpose.
2. Authorization tests, including cross-tenant and revoked-access negative tests.
3. Encryption and secret-handling checks.
4. Export/import round-trip with checksums and schema/version compatibility.
5. Backup restore in an isolated environment.
6. Restart recovery and peer/provider loss recovery where applicable.
7. Migration parity, rollback, and interrupted-migration tests.
8. Deletion/retention behavior across primary stores, indexes, caches, replicas, and backup lifecycle.
9. Audit events for privileged access and data egress.
10. Independent review of the implementation and test evidence.
11. Current CI results tied to the exact commit; production-path tests for claims about production.
12. Clear remaining risks, unavailable dependencies, and untested claims.

A passing unit test proves only the behavior it exercises. A readiness probe proves only the probe. A configuration setting proves nothing unless the live path enforces it.

## 8. Incident and recovery response

- Maintain a data asset register, dependency map, recovery runbook, and named accountable owner.
- On suspected corruption, unauthorized deletion, or compromise: stop destructive automation, preserve evidence, isolate affected credentials/paths, determine blast radius, restore from verified clean copies, and independently validate recovered data before resuming writes.
- Never overwrite the only known-good copy with a possibly corrupted replica.
- Test recovery drills periodically and after material storage changes.
- Track recovery objectives and report any missed objective honestly.

## 9. Implementation sequence

P0 — inventory production data paths, all fallbacks, tenants/namespaces, egress routes, backup/replica failure domains, keys, and deletion paths.
P1 — add destructive-operation guardrails, verified snapshots, restore drills, export manifests/checksums, tenant-isolation tests, and auditable approvals.
P2 — enforce purpose/provenance/rights metadata and customer-data egress controls for AI, search, analytics, and integrations.
P3 — implement self-service portability, lifecycle controls, correction/deletion workflows, and tested recovery status.
P4 — publish evidence-backed service levels, data-product catalog, incident practices, and independent assurance reports.

Do not remove legacy storage or data until P0/P1 gates pass. Work must proceed incrementally with evidence; no blanket completion claims.
