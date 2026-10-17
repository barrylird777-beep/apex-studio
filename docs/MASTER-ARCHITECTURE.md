# APEX ECOSYSTEM — CANONICAL ARCHITECTURE

**APEX ANCHOR: preserve the six app identities; recover capabilities without reviving obsolete app names.**

## Six canonical apps

1. **PlanetApeX — brain:** Bible study, research, knowledge, AI, world/universe analytics, and interactive experiences. **GardenApex is the living Jesus Freaks / KORNS PEOPLE universe inside PlanetApeX.** GardenOfApex is historical/absorbed, not a seventh app. Answers must distinguish KNOWN, OBSERVED, INFERRED, and UNKNOWN.
2. **XShield — shield:** security and privacy, ad/tracker blocking, DNS protection, content filtering and protected connectivity. KoBlocks remains a reusable workflow capability, not a separate app.
3. **KernelVision — eyes:** creative production and delivery: direction, scripts, scenes, images, video, animation, VFX, editing, mixing/mastering, rendering, QC, publishing, Special Search, and social/manager analytics. KernelVision Theatre and Kornmax are experiences inside this app.
4. **KoinKob — autonomous economy:** worker accounts, asset markets, market clearing and settlement, systemic events, adversarial rounds, and the 2,000-worker simulation.
5. **KashKorner — money/connectivity:** cash flow, ledger and financial state, monetization, and connectivity coordination; carry forward relevant EngineApex/Apexus capabilities without creating extra app identities.
6. **Kernelodies — ears:** music, sound, audio creation, discovery, and audio identity. Jesus Freaks / KORNS PEOPLE music follows the locked 432 Hz rule.

## Historical lineage

ApexStudios, KORNKNOB, ShieldApex, EngineApex, Apexus, GardenOfApex, TeeVee, and PayPex are historical names, systems, or capability surfaces to recover. They are not automatically separate current apps. Their surviving capabilities belong under the six identities above. GardenApex is the current living universe inside PlanetApeX. XShield is one of the six canonical apps, not a seventh app.

## Sovereignty and storage

- **Target:** no WAL, no local disk as the system of record, no PostgreSQL, and no persisted JSON records. Use authenticated remote CAS/peer-backed persistence with isolated per-app namespaces and verified replica/peer receipts.
- **Current implementation is not yet compliant:** local and remote WAL classes remain in the codebase, the store can select a local fallback when remote mode is disabled, and the remote CAS serializes objects/manifests as JSON. A remote-CAS readiness probe is only a probe; it does not prove all production writes use the intended storage path.
- Keep each app's records isolated. Shared handoffs must be authenticated, validated, durable, idempotent, and acknowledged by the receiving peer before being reported delivered.
- PostgreSQL-era modules, scripts, and instructions are legacy until proven unused and retired safely. Never delete old data or infrastructure as a shortcut.
- A live service or passing unit test is not proof of full product behavior. Release evidence must include real artifacts, restart/failure recovery, working iPhone controls, and confirmed cross-app handoffs.

## Connectivity and sovereignty

- Support multiple available transports and paths where the device and network permit; measure client-side paths rather than inferring phone connectivity from server health.
- Work toward provider-independent communication through authenticated peer networking and available Wi-Fi, wired, satellite, or lawful radio infrastructure. Software alone cannot create radio coverage or bypass the need for a physical transport.
- The peer runtime must preserve identity, use authenticated encryption, enforce allowlists, and report actual peer acknowledgements. A public address or a running local peer alone does not prove a working mesh.
- Public user access uses authenticated HTTPS; peer-to-peer transport remains separately authenticated and allowlisted.
- Do not claim multipath, automatic failover, global peer connectivity, or cellular-provider independence until end-to-end tests prove it.

## Search and research

- KernelVision's **Special Search** is an optional native production-discovery interface, not a mandatory gateway.
- Search should federate available web sources, scholarly records, app knowledge, indexed assets, provider/model catalogs, datasets, tools, services, and authenticated peers as each source is available.
- Deduplicate results, retain source URLs and timestamps, show provenance, respect access controls and robots/rate limits, and distinguish complete results from partial/provider-limited results.
- “Unlimited search” is a goal of broad extensibility and federated discovery, not a claim that the public internet, private data, or rate-limited services have no limits.

## App integration

- Keep all six apps distinct, with independent identities and isolated namespaces.
- PlanetApeX owns Bible/research/knowledge experiences, including GardenApex.
- KoBlocks composes and validates workflows.
- KernelVision owns production, publishing, analytics, and Special Search.
- KoinKob owns economic simulation and market logic.
- KashKorner owns cash/ledger and connectivity coordination.
- Kernelodies owns music and sound capabilities.
- Shared services may be reused, but no app is declared complete merely because another app passes.

## Verification and change policy

- BLACK-PEN finds reproducible defects and root causes.
- King Cob independently inspects the final result; implementers do not certify their own work.
- Preserve existing data and deployments. Do not rename, delete, rebuild, or change production configuration without a verified reason and appropriate authorization.
- Report what was actually searched, tested, merged, and deployed. Record blockers and unknowns plainly.

## Specialized six-app backplanes

The detailed target design for each app's specialized backend, shared control planes, data governance and commercialization, durable job orchestration, security boundaries, observability, recovery, and release gates is maintained in [`docs/architecture/APEX-SIX-APP-BACKPLANE-ARCHITECTURE.md`](architecture/APEX-SIX-APP-BACKPLANE-ARCHITECTURE.md).

This linked document is a target architecture, not evidence that its components are implemented, deployed, or production-ready. The current storage and runtime gaps above remain open until independently verified against live systems.
