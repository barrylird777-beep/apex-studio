# PlanetApeX Ecosystem — Canonical Architecture

**APEX ANCHOR: preserve the six app identities; recover capabilities without reviving obsolete app names.**

## The six canonical apps

1. **PlanetApeX — brain:** Bible study, research, knowledge, AI, world/universe analytics and interactive experiences. **GardenOfApex is the Jesus Freaks / KORNS PEOPLE universe inside PlanetApeX**, not a seventh app.
2. **XShield — shield:** security, ad/tracker blocking, DNS filtering and protected connectivity. Never block whole sites/apps as a default.
3. **KernelVision — eyes:** creative production and delivery: direction, scripts, scenes, images, video, animation, VFX, editing, mixing/mastering, rendering, QC, publishing, Special Search and social/manager analytics. KernelVision Theatre and Kornmax are viewing experiences within this app.
4. **KoinKob — economy:** worker markets, value, barter, market clearing and economic simulation. Exact remaining historical purpose decisions must be evidence-backed, not guessed.
5. **KashKorner — cash/connectivity:** cash flow, ledger and financial state, carrying forward relevant EngineApex/Apexus connectivity lineage without creating extra app identities.
6. **Kernelodies — ears:** music, sound, audio creation, discovery and audio identity. Jesus Freaks / KORNS PEOPLE music follows the locked 432 Hz rule.

## Historical lineage

ApexStudios, KORNKNOB, ShieldApex, EngineApex, Apexus, GardenOfApex and related names are historical systems, names or capabilities to recover. They are **not automatically separate current apps**. Their surviving capabilities belong under the six identities above. TeeVee and PayPex are supporting/legacy capability surfaces, not extra canonical apps.

## Integration and sovereignty

- Keep all six apps distinct, with separate identities and isolated data namespaces.
- Shared handoffs must be authenticated, validated, durable and idempotent. A queued handoff is not proof of peer delivery; only verified peer acknowledgements count.
- Preserve the Pure-WAL/Ring-WAL sovereign storage direction. **Do not restore PostgreSQL or introduce SQL/SQLite runtime dependencies.** PostgreSQL-era callers and migration utilities are legacy work to retire; current production is not considered complete until those runtime paths are removed or proven inactive and the queue/storage/recovery tests pass.
- Keep path confinement, symlink checks, atomic writes, fsync, hash-chain verification, fail-closed peer authorization and independent inspection.
- Network status must describe measured client/server paths accurately. Do not claim multipath, failover, or worldwide peer connectivity without end-to-end evidence.
- Public access should work over authenticated HTTPS; peer-to-peer networking must remain separately authenticated and allowlisted.
- Production claims require real evidence: real output artifacts, durable recovery after restart, working iPhone controls, and confirmed cross-app handoffs.

## Development

```bash
npm install
npm start
```

## Current implementation note

This repository contains the shared implementation surfaces for the six-app layer. A live Railway service does not by itself prove every feature works. The active recovery work is correcting the canonical registry, retiring broken PostgreSQL-backed worker execution in favor of Pure-WAL, and verifying secure peer transport and app-to-app flows before release.
