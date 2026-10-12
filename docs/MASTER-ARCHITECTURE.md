# APEX ECOSYSTEM — CANONICAL ARCHITECTURE

**APEX ANCHOR: preserve the six app identities; recover capabilities without reviving obsolete app names.**

## Six canonical apps

1. **PlanetApeX — brain:** Bible study, research, knowledge, AI, world/universe analytics, and interactive experiences. **GardenOfApex is the Jesus Freaks / KORNS PEOPLE universe inside PlanetApeX**, not a seventh app. Answers must distinguish KNOWN, OBSERVED, INFERRED, and UNKNOWN.
2. **KoBlocks — workflow blocks:** reusable execution blocks, graph composition, validation, and cross-app workflow orchestration.
3. **KernelVision — eyes:** creative production and delivery: direction, scripts, scenes, images, video, animation, VFX, editing, mixing/mastering, rendering, QC, publishing, Special Search, and social/manager analytics. KernelVision Theatre and Kornmax are experiences inside this app.
4. **KoinKob — autonomous economy:** worker accounts, asset markets, market clearing and settlement, systemic events, adversarial rounds, and the 2,000-worker simulation.
5. **KashKorner — cash/connectivity:** cash flow, ledger and financial state, monetization, and connectivity coordination; carry forward relevant EngineApex/Apexus capabilities without creating extra app identities.
6. **Kernelodies — ears:** music, sound, audio creation, discovery, and audio identity. Jesus Freaks / KORNS PEOPLE music follows the locked 432 Hz rule.

## Historical lineage

ApexStudios, KORNKNOB, XShield, ShieldApex, EngineApex, Apexus, GardenOfApex, TeeVee, and PayPex are historical names, systems, or capability surfaces to recover. They are not automatically separate current apps. Their surviving capabilities belong under the six identities above. XShield is supporting network protection, not a seventh app.

## Sovereignty and storage

- **Pure-WAL / Ring-WAL is the required durable-storage direction. Do not restore PostgreSQL or introduce SQL/SQLite runtime dependencies.**
- Local durable state, atomic writes, fsync, hash-chain verification, path confinement, symlink checks, and corruption recovery must be tested.
- Isolate each app's records in its own namespace. Shared handoffs must be authenticated, validated, durable, idempotent, and acknowledged by the receiving peer before being reported delivered.
- PostgreSQL-era modules, scripts, and instructions are legacy until proven unused and retired safely. Never delete old data or infrastructure as a shortcut.
- A live service or passing unit test is not proof of full product behavior. Release evidence must include real artifacts, restart recovery, working iPhone controls, and confirmed cross-app handoffs.

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
- PlanetApeX owns Bible/research/knowledge experiences, including GardenOfApex.
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
