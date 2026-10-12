# Cloud Authority Cutover Gate

Status: **NOT CUT OVER**. This document records verified limits; it is not deployment approval.

## Confirmed
- The production Railway project has an S3-compatible bucket named `apex-media-vault`.
- Railway's published bucket pricing is **$0.015 per GB-month**. Because the user forbids unapproved paid resources, no live probe or migration write may target this bucket until its cost is explicitly approved or a verified no-cost target is chosen.
- The `apex-studio` service exposes the five `APEX_OBJECT_STORAGE_*` variable names, but their values are redacted to this connector. Presence is not proof of successful authentication or object writes.
- `src/storage/cloud-record-store.mjs` is an S3-compatible record adapter with record-envelope integrity checks and no local fallback.
- The adapter is not wired into `ApexPureStore`, the six-app fabric, or the durable worker queue.
- `ApexPureStore` and the Kernelodies library API still use filesystem-backed state.
- The cloud adapter does not provide verified cross-process compare-and-swap, fencing, or distributed locking. It must not be treated as a durable multi-worker queue.

## Required before cutover
1. Select a storage target consistent with the no-paid-resources constraint. Only then run the live cloud probe: write, read, verify checksum, read through a fresh client/process, delete, and confirm absence.
2. Choose and prove a single-writer or provider-supported atomic coordination strategy for app records and worker jobs. Do not assume object storage provides transactional queue semantics.
3. Inventory existing state and provide a read-only export with record/job counts and hashes; compare the remote copy before cutover.
4. Prove restart recovery and worker lease/fencing behavior with at least two independent worker processes.
5. Run the complete CI suite and have an independent reviewer inspect the diff.
6. Keep production on the current path until all gates pass. Never silently fall back to local files in cloud-required mode.

## Safety
- No production storage mode was changed by this work.
- No production records were migrated or deleted.
- No paid resource was created.
