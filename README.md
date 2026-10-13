# PlanetApeX Ecosystem — Canonical Architecture

**APEX ANCHOR: preserve the six app identities; recover capabilities without reviving obsolete app names.**

## The six canonical apps

1. **PlanetApeX — brain:** Bible study, research, knowledge, AI, world/universe analytics and interactive experiences. **GardenApex is the living Jesus Freaks / KORNS PEOPLE universe inside PlanetApeX**, not a seventh app.
2. **XShield — shield:** security and privacy, ad/tracker blocking, DNS protection, content filtering and protected connectivity. KoBlocks remains a reusable workflow capability, not a separate app.
3. **KernelVision — eyes:** creative production and delivery: direction, scripts, scenes, images, video, animation, VFX, editing, mixing/mastering, rendering, QC, publishing, Special Search and social/manager analytics. KernelVision Theatre and Kornmax are viewing experiences within this app.
4. **KoinKob — autonomous economy:** worker accounts, asset markets, market clearing and settlement, systemic events, adversarial rounds, and a 2,000-worker simulation exploring how a society organizes itself.
5. **KashKorner — cash/connectivity:** cash flow, ledger and financial state, carrying forward relevant EngineApex/Apexus connectivity lineage without creating extra app identities.
6. **Kernelodies — ears:** music, sound, audio creation, discovery and audio identity. Jesus Freaks / KORNS PEOPLE music follows the locked 432 Hz rule.

## Historical lineage

ApexStudios, KORNKNOB, ShieldApex, EngineApex, Apexus, GardenOfApex and related names are historical systems, names or capabilities to recover. KoBlocks is a reusable workflow capability, not a separate canonical app. GardenOfApex is historical; GardenApex is the living universe inside PlanetApeX. TeeVee and PayPex are supporting/legacy capability surfaces, not extra canonical apps.

## Integration and sovereignty

- Keep all six apps distinct, with separate identities and isolated data namespaces. Shared transport does not grant cross-app data access. Shared transport does not grant cross-app data access.
- Shared handoffs must be authenticated, validated, durable and idempotent. A queued handoff is not proof of peer delivery; only verified peer acknowledgements count.
- Use content-addressed durable storage for active writes. **Do not restore WAL writes, PostgreSQL, or SQL/SQLite runtime dependencies.** Legacy WAL files are read-only migration/rollback evidence; current production is not complete until active write paths are removed and the queue/storage/recovery tests pass.
- Keep path confinement, symlink checks, atomic writes, fsync, hash-chain verification, fail-closed peer authorization and independent inspection.
- Network status must describe measured client/server paths accurately. Do not claim multipath, failover, or worldwide peer connectivity without end-to-end evidence.
- Public access should work over authenticated HTTPS; peer-to-peer networking must remain separately authenticated and allowlisted.
- Production claims require real evidence: real output artifacts, durable recovery after restart, working iPhone controls, and confirmed cross-app handoffs.

## Cloud-exit objective

The target is a $0-incremental-cost, phone-first peer network that does not require Railway or a hosted object store to remain mandatory. It must use authenticated peers, encrypted private objects, per-app namespaces, content-addressed chunks, verified replica receipts, resumable transfers and recovery/repair. Capacity grows only as real participating peers contribute reachable storage, compute and bandwidth; it is not literally infinite. Do not disable existing storage until the peer-backed data plane passes migration and failure tests.

The staged plan and acceptance gates are in [APEX Sovereign Cloud-Exit Architecture](docs/architecture/APEX-SOVEREIGN-CLOUD-EXIT.md).

## Development

```bash
npm install
npm start
```

## Current implementation note

This repository contains the shared implementation surfaces for the six-app layer. A live Railway service does not by itself prove every feature works. The active recovery work is correcting the canonical registry, retiring PostgreSQL-backed worker execution in favor of content-addressed storage, and verifying secure peer transport and app-to-app flows before release.
