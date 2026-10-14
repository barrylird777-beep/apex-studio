# Railway Exit Recovery Inventory

**Purpose:** Preserve recoverable configuration and identify data that must be exported before any Railway resource is changed.
**Safety rule:** This inventory does not authorize deletion, credential rotation, or volume reattachment. Do not treat failed deployments as proof that stored data is empty.
**Captured:** 2026-10-14 from the connected Railway project inventory.

## Projects

### `helpful-laughter`
- Project ID: `eefb6f5e-2454-45b9-98c4-41b9baaa1074`
- Environment: `production` (`77e4a45a-0d8c-41f3-9fd3-9d76f6984ae2`)
- Region for services: `sfo`

Services:
- `apex-studio` — `837ab656-0d9f-4098-bb1b-2e3f24c9f693`; source repo `barrylird777-beep/apex-studio`; domain `apex-studio-production.up.railway.app`; start command `npm run start:sovereign-stack`; latest deployment `125ad322-62c8-47c5-8a66-8fa5e6c908b3` FAILED (2026-10-14 01:53 UTC).
- `apex-sovereign-peer-2` — `c6f3b870-8d40-4b36-987e-7f9adae0e43a`; branch `apex/sovereign-peer-security-hardening`; pinned commit `48231c408ee239a815d141841a57a92bd6053df0`; latest deployment `f213f58d-1b7b-416a-8eb3-4e6865a1f6fd` FAILED.
- `apex-workers` — `f591306e-c500-474f-8c4e-7a1a92ee438a`; start command `APEX_WORKER_ONLY=true node index.mjs`; latest deployment `bb94de94-106b-4bd4-bfa4-c7366d2ce927` FAILED.
- `apex-studio-foundation` — `108f7f4c-ea06-40a4-9407-59be1d7f6ed7`; currently configured to print that the legacy PostgreSQL-backed foundation is quiesced; restart policy NEVER.

### Persistent volumes — DO NOT DELETE
- `postgres-volume-20gb` — ID `63bf4041-00c4-4a89-8084-d68275674eb4`; reported size 500 MB; currently unmounted.
- `apex-peer-2-se-x` — ID `74ea015b-a3ca-4b34-ab34-4fb40b9a9c03`; reported size 500 MB; currently unmounted.

An unmounted volume can still contain data. The name `postgres-volume-20gb` and 500 MB reported size do not establish its contents.

### Object storage
- Bucket: `apex-media-vault`
- Bucket ID: `3d605125-6158-46f6-bffa-91de809153ae`
- S3-compatible endpoint: `https://t3.storageapi.dev`
- Bucket name at endpoint: `apex-media-vault-uf44kgn9`
- Region: `auto`; URL style: virtual-host
- Credentials were withheld by the connected Railway integration. No credential rotation was performed. Bucket contents have **not** been exported or verified.

## Separate project: `music-radar`
- Project ID: `f69b7c86-fab3-4990-808e-0255057f38f7`
- Environment ID: `5934a807-55ce-4454-8814-d174de29653d`
- Service `postgres` ID `a4eecef3-222c-45c7-99a5-56637bf19e1b`, image `postgres:17`.
- This service is inventoried for preservation only. Do not make it the replacement storage system.

## Configuration capture status

Railway returned variable **names only**, not values. The live connection reports values redacted, so secrets, tokens, private peer keys, database URLs, and object-store credentials cannot be reconstructed from this inventory. Do not replace unreadable/sealed values with blanks or guesses.

The `apex-studio` variable-name inventory includes:
`APEX_ALLOWED_PEER_IDS`, `APEX_BOOTSTRAP_PEERS`, `APEX_CAS_REMOTE_ENABLED`, `APEX_CONTROL_TOKEN`, `APEX_OBJECT_STORAGE_ACCESS_KEY_ID`, `APEX_OBJECT_STORAGE_BUCKET`, `APEX_OBJECT_STORAGE_ENDPOINT`, `APEX_OBJECT_STORAGE_REGION`, `APEX_OBJECT_STORAGE_SECRET_ACCESS_KEY`, `APEX_PEER_PRIVATE_KEY_BASE64`, `APEX_SOVEREIGN_STORAGE_DIR`, `APEX_WAL_DIR`, `APEX_WAL_FILE`, `DATABASE_URL`, `APEX_OWNER_PASSWORD`, `APEX_WORKER_TOKEN`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, plus app/model/worker configuration. Names are not values.

The peer service has peer identity/bootstrap/allowed-peer/object-store variables plus `APEX_WAL_DIR` and `APEX_WAL_FILE` names. The worker has object-store variables, worker auth/lease/polling settings, `DATABASE_URL`, and `GEMINI_API_KEY` names. No secret values are included here.

## Exit order — preserve before changing

1. Export and checksum the complete GitHub repository separately from Railway configuration.
2. Obtain an authorized, readable Railway export path for each unmounted volume; make read-only images/copies before attempting to mount them. Never mount an untrusted data volume over an application path.
3. Export every object and metadata record from `apex-media-vault`; produce an object listing, sizes, checksums, and a verified second copy outside Railway.
4. Capture service configuration, deployment logs, build logs, custom domains, TCP proxy settings, variables, and deployment commit IDs. Secrets must go directly to a secure destination; do not commit them to Git.
5. Verify the exports by listing and checksum comparison, and test restoration away from Railway.
6. Only after independent verification: plan service cutover. Do not delete Railway resources until the user explicitly confirms the independent copy is complete.

## What is and is not proven

- Proven: repository source is hosted on GitHub; the listed Railway resources and configurations exist in the inventory response.
- Not proven: that either unmounted volume is empty; that the bucket is empty; that all objects have been copied; that secrets are recoverable from this OAuth connection; or that the mesh can run without Railway.
- No Railway resource was deleted, no volume was mounted, and no credentials were reset during this capture.


## Additional runtime evidence captured after the initial inventory

Recent deployment history shows that a build from main commit `c71eba8bc2470e9ca8d220d4216571566d3189c2` (`Add browser peer object storage and phone diagnostics`) did build and start on 2026-10-14. The deployment ID was `62c36ba3-8b65-462d-9c84-69daaec4f4f7`. Build logs show Vite completed and Railway's `/health` check succeeded. Runtime logs then showed peer stream opens and heartbeat acknowledgements, **but** repeated `Access Denied` errors followed; Railway sent SIGTERM at approximately 03:50:39 UTC and the deployment was subsequently marked `REMOVED`. This is evidence of a brief running process, not a healthy durable storage system.

The peer deployment `9ccd108f-6cf2-4edf-80b5-86a53a1017e5` also logged peer heartbeats/acknowledgements, then repeated `Access Denied` failures. Its shutdown evidence reported:
- reconcile: `scanned=0, persisted=0, acknowledged=0`
- offline identity commit failed with `Access Denied`
- peer stopped; runtime did not prove a successful final storage write.

Worker logs repeatedly report queue polling timeouts and eventually `Remote worker API 503: Access Denied`. One worker deployment's recorded failure stage was `PRE_DEPLOY_COMMAND`, with the pre-deploy command exceeding 600 seconds.

### Export utility committed to this recovery branch

`scripts/export-railway-bucket.mjs` is a read-only S3-compatible bucket exporter. It paginates object listings, downloads each object, checks its byte count, computes SHA-256 while streaming, and writes plain TSV inventories and a completion marker. It requires the bucket's endpoint/name/credentials as environment variables; no credentials are committed. It has not been run against the live bucket because the connected Railway integration withholds the secret key values.

### Current extraction boundary

The connected Railway integration exposes resource inventory and logs but does not expose raw volume bytes, deployment image archives, or readable bucket credentials. It cannot directly copy the two unmounted volumes or enumerate/download bucket objects from this session. The exporter is prepared, but a successful export still requires a trusted execution environment with authorized bucket credentials. Do not mark this recovery complete until actual object counts, sizes, checksums, and an independent second copy have been verified.
