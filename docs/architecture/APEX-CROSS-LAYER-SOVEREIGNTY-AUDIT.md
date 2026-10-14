# APEX cross-layer sovereignty audit

Audit target: `apex-anchor/no-json-postgres-wal`, based on `apex/sovereign-cloud-exit-v2`.

This is a source audit, not a claim that the deployed network is healthy. Findings below were verified by inspecting the current source paths.

## Parallel findings

| Layer | Existing capability | Blocking gap |
|---|---|---|
| Storage | Encrypted peer content-addressed store; canonical CBOR codec; authenticated peer storage adapter | The active mesh engine still chooses a local filesystem CAS when remote mode is not selected. The older local and remote CAS implementations persist JSON objects/manifests. The peer-storage handler is opt-in and requires an injected peer-owned binary backend. |
| Network | libp2p/Noise peer transport, peer allowlists, explicit peer-ID-to-multiaddress mapping, peer ACK path | Storage adapter requires explicitly provisioned addresses; no automatic peer discovery/placement is wired into this path. The presence of transport code is not proof of reachable peers or replicated durability. |
| Security | AES-256-GCM encryption in the peer CAS; app namespace validation; explicit ACLs; peer identity checks | App-facing write paths are not yet universally routed through the peer CAS. Key provisioning/rotation and full app-to-peer authorization need end-to-end proof. JSON peer envelopes are transient protocol framing; this audit targets durable JSON persistence, not JSON control messages. |
| Runtime/infrastructure | Separate API and sovereign runtime processes; peer runtime entry point; startup and health scripts | The stack supervisor no longer runs the local migration or PostgreSQL archival helper. The runtime daemon still imports WAL readiness/retry logic, the legacy durable store, filesystem migration, and a filesystem-backed mesh engine. These remain direct conflicts with the requested target. |
| Architecture/operations | Existing cloud-exit design documents app isolation, replica quorum, failure domains, repair and verified recovery | Live multi-peer write/read/restart/loss tests, measured usable capacity, and independent peer durability are not currently established by source inspection. Railway services/bucket removal and recovery of old data are separate unverified operations. |

## Immediate blockers (in dependency order)

1. Remove WAL and legacy-store readiness dependencies from the runtime; replace them with peer-store readiness based on an actual authenticated write/read round-trip and replica quorum. The supervisor-side migration/archive invocation has been removed, but the daemon's own migration call remains.
2. Remove startup filesystem migration and the local filesystem CAS from the production write path. Preserve any remaining legacy source read-only until exports/checksums are verified.
3. Replace durable JSON objects/manifests in legacy CAS adapters with versioned binary records, or retire those adapters from active production paths. Do not confuse transient JSON HTTP/peer envelopes with JSON persistence.
4. Inject a peer-owned binary backend into inbound storage, route app-facing durable writes/reads through the peer CAS, and enforce app namespace ACLs at every operation.
5. Provision stable identities and reachable addresses for independent peers; test unauthorized peer rejection, corrupted data, interruption/resume, restart, peer loss, and replica repair.
6. Make health/readiness report actual peer reachability, verified replica count, quorum, and durable readback. Process liveness alone is insufficient.
7. Verify infrastructure cutover and data recovery independently. Do not delete any remaining source or claim Railway disconnection until each operation is explicitly confirmed.

## Static guard

Run `npm run verify:sovereignty`. It is deliberately expected to fail while known prohibited active paths remain. A pass means only that the configured static patterns are absent; it does not prove a live mesh, data recovery, or production deployment.

## Non-negotiable invariants

- Six canonical apps only: PlanetApeX, XShield, KernelVision, Kernelodies, KashKorner, KoinKob.
- No PostgreSQL, no WAL, no durable JSON records/manifests, no device-local source of truth, no paid mandatory storage or hosting.
- No silent fallback when peer quorum is unavailable; fail closed and report the real state.
- Preserve source data until independently verified recovery/cutover; never imply deleted volumes can be recovered without surviving copies or backups.
