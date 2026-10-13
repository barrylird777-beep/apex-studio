# APEX Railway Exit — Free-First Architecture

Status: architecture baseline and migration gates. This document does not claim that Railway has been removed or that any new provider is live.

## Non-negotiable invariants

- Preserve all six canonical app identities: KernelVision, XShield, Kernelodies, PlanetApeX, KashKorner, and KoinKob.
- Keep app APIs, authorization scopes, user data, and secrets isolated by app identity. Shared infrastructure is not shared authorization.
- Spend $0: use existing free tiers only. No new paid services, subscriptions, storage, domains, or credits.
- No PostgreSQL dependency, no app-owned local disk as a source of truth, and no custom WAL/JSON-file persistence as the durable record.
- Do not delete, reset, or migrate the only copy of any data. Copy, verify checksums and counts, switch reads/writes only after verification, and retain rollback until the new path is proven.
- Never label a service healthy based only on HTTP liveness. Readiness must test the required runtime path and durable store.
- Phone-first control and recovery must work from the web surface; no Mac or local development machine is a prerequisite for routine operations.

## Target shape

```text
iPhone / browser
    |
    +-- Static app shells and installable PWA (edge CDN)
    |
    +-- Authenticated API / control plane (edge-compatible handlers)
              |
              +-- App-scoped durable records (managed cloud database)
              +-- Content-addressed object storage (media, exports, blobs)
              +-- Queue / lease / heartbeat interfaces
                         |
                         +-- Browser/WebRTC peer workers (best-effort capacity)
                         +-- Portable server workers for jobs needing Node/native tools
```

The six app shells remain distinct products. The edge gateway may share routing and security libraries, but every request must carry a verified app scope and tenant/user scope. Peer compute is untrusted: use signed task envelopes, explicit capability grants, bounded payloads, checksum verification, timeouts, and no secret-bearing work on untrusted peers.

## Provider strategy (free-tier first, not provider lock-in)

1. **Static frontend:** deploy static assets to an edge Pages/CDN service. The source remains GitHub; builds must be reproducible from a clean checkout.
2. **Edge API:** use small standards-based request handlers where they fit the runtime. Keep domain logic free of provider SDKs and Node-only APIs. Do not move FFmpeg/native workloads into an edge runtime that cannot run them.
3. **Durable structured state:** define a storage interface and select a managed free-tier implementation only after its quota, export path, access control, and actual account availability are verified. No local disk, JSON files, or PostgreSQL as the system of record.
4. **Binary/media storage:** use an object-store adapter with content hashes, streaming upload/download, range reads where supported, and explicit retention/quotas. Verify actual free allowance before relying on it; do not assume unlimited storage.
5. **Workers:** use WebRTC/browser peers for eligible, non-sensitive, retryable work; use a portable Node worker for native rendering and tasks that need filesystem/process access. Peers are supplemental, not required for correctness.
6. **Provider independence:** storage, queue, identity, and compute are adapters with contract tests. The core domain layer must not import Railway-specific APIs.

Cloudflare Pages/Workers/R2 are a candidate for the edge and object layers because they have published free tiers, not a pre-approved or already-live destination. D1 is a candidate for structured records only after verifying it satisfies the project's durability, isolation, export, and no-custom-WAL constraints. Do not provision a resource until the active account/workspace and free-tier limits are confirmed.

## Migration sequence — no cutover until each gate passes

### Gate 0 — inventory (read-only)
- Inventory every Railway project, service, environment, domain, volume, bucket, variable name, latest deployment, worker, and job schedule.
- Inventory GitHub workflows, app entry points, Node/native dependencies, health/readiness routes, and current storage adapters.
- Map every persistent data class to its current owner and recovery/export method. Do not print secret values into logs or reports.
- Record current public URLs and smoke-test results.

### Gate 1 — isolate portability seams
- Create provider-neutral interfaces for durable records, object blobs, task queue/leases, secrets, and service health.
- Add adapter contract tests and app-scope tests.
- Mark Node-only/native modules explicitly so edge builds cannot import them accidentally.
- Keep current deployment untouched during this work.

### Gate 2 — deploy parallel, non-authoritative edge shell
- Publish static assets from GitHub to the free edge host.
- Verify installability, mobile viewport, offline shell, cache invalidation, and all six app boundaries.
- Keep writes disabled until identity and data isolation tests pass.

### Gate 3 — deploy parallel API and workers
- Deploy edge-safe endpoints separately from native/long-running jobs.
- Add authenticated readiness checks that prove the API can reach required adapters.
- Verify job idempotency, lease expiry, duplicate delivery, cancellation, graceful shutdown, and checksum validation.
- Do not route production writes yet.

### Gate 4 — copy and verify durable data
- Export source records and blobs without deleting the originals.
- Copy with stable IDs and content hashes; compare counts, checksums, referential integrity, and per-app access boundaries.
- Run read-only shadow comparisons against representative requests.
- Document rollback and restore steps before enabling any writes.

### Gate 5 — controlled cutover
- Switch a small read-only route first, then a low-risk write path.
- Monitor errors, latency, quota use, failed jobs, data drift, and recovery.
- Switch remaining routes only after evidence is clean.
- Keep Railway running during the rollback window; only decommission after all six apps and every data class are verified off-platform.

## Required acceptance evidence

- Six app IDs are present and cannot cross-read one another's private records.
- No durable write targets a local filesystem, JSON state file, or PostgreSQL.
- Static assets and API responses work from an iPhone-sized viewport.
- Health and readiness are distinct; readiness fails closed if required dependencies are unavailable.
- All migrated records/blobs have matching counts and checksums.
- Worker retries are idempotent; duplicate or stale leases cannot complete the same job twice.
- Restore test succeeds using only the documented cloud-side backup/export.
- Current and projected usage remain within free quotas; no paid resource is created.
- Old Railway resources remain intact until every acceptance gate passes.

## Known risks and constraints

- Edge runtimes do not generally support arbitrary Node native modules, long-running processes, or native FFmpeg binaries. Keep those workloads in a portable worker tier or use browser/WebRTC offload where suitable.
- Free services may sleep, throttle, or enforce usage caps. A $0 architecture can be designed, but uninterrupted 24/7 compute and unlimited durable storage cannot be promised on free tiers.
- Browser peer capacity is opportunistic. It cannot be the sole copy of data or the only worker capable of a required job.
- Secrets must remain in provider secret stores; never embed them in static bundles or commits.
- The current repository contains legacy PostgreSQL scripts and a JSON-file store module. This document does not claim they are unused. They must be traced and removed from active runtime paths only after usage and migration are proven.

## Immediate next implementation tasks

1. Inventory the current storage/queue adapters and identify every runtime import of PostgreSQL, JSON-file persistence, local disk, and Railway-specific behavior.
2. Add a machine-readable provider capability manifest and fail-closed readiness checks.
3. Add storage and queue adapter contract tests before selecting a new durable backend.
4. Prepare the static edge build separately from the Node/native worker build.
5. Run the repository's relevant CI/smoke tests and publish results with commit references.
