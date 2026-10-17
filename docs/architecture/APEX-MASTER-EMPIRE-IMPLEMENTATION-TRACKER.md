# APEX Master Empire — Implementation Tracker

**Branch:** security/below-zero-trust-wall-to-wall-20261016  
**Pull request:** [#638 — Enforce below-zero-trust storage boundary and map A-006 blockers](https://github.com/barrylird777-beep/apex-studio/pull/638)  
**Tracking rule:** A committed change is not VERIFIED until the exact head has passing checks and independent runtime evidence. This tracker does not replace the user-provided blueprint or locked canon.

## Implemented in code; runtime verification pending

- **Free AI rotation:** Groq, Google AI Studio, OpenRouter free models, Mistral, Cloudflare Workers AI, and Pollinations; explicit free-tier opt-ins where applicable; no paid fallback from free mode.
- **Peer media objects:** hierarchical, bounded blob manifests; per-node byte-length and SHA-256 validation; replica receipts returned for the root; configurable blob budget (512 MiB default, 1 GiB maximum).
- **Production persistence guard:** local project-manifest/media writes fail closed until a peer-backed media adapter is connected and recovery-verified.
- **Peer request security:** protocol 1.2.0; sender identity binding, request digest, freshness validation, configured trust-epoch matching/revocation at production ingress, replay detection, and bounded in-memory cached ACK responses. Trust epochs are a process-start configuration snapshot, not yet a dynamically replicated revocation service; operator rotation/revocation steps are documented in docs/architecture/PEER-TRUST-EPOCHS.md.
- **KashKorner contingency audit:** authenticated structured-contract/invoice audit endpoint and UI; missing-term, reference, amount, currency, date, and contingency-fee checks; no persistence or external transmission by the audit route.
- **GardenApex audio overview:** source-constrained two-host script generation, supplied-source citation validation, and browser speech-synthesis playback; notes are disclosed as sent to the configured AI provider, URLs are not fetched, and no audio file is created.
- **Apex Assistant overlay:** authenticated text prompts, browser speech input when supported, interruptible speech playback, and text fallback; it discloses AI-provider and browser speech-service handling and does not persist conversation history. This is not yet true full-duplex voice.
- **Signed release policy:** Ed25519-signed content-addressed release manifests, artifact/path validation, monotonic release sequencing, separately signed rollback authorization to a known manifest, and a CLI to sign manifests and verify actual artifact bytes. Commands: npm run release:manifest:sign, npm run release:manifest:verify, npm run release:rollback:sign, and npm run release:rollback:verify. The CLI is not yet wired into the live deployment/update path.
- **Regression coverage:** focused AI-rotation, peer-blob, and KashKorner audit test commands are registered; production storage and peer-security tests are included in the test suite.

## Verification state

- Source/config/test changes have been independently read back from GitHub.
- GitHub Actions for the current branch head are queued/pending; passing CI has not been established for the latest commits.
- No deployment was performed.
- No physical peer restart, replica-loss, recovery, or repair proof was produced by these code changes.

## Open blockers before claiming the blueprint functional

1. Wire peer-backed media storage into all production asset reads/writes and the /files serving/render pipeline; preserve six distinct canonical app namespaces.
2. Provide authenticated, independently operated peer machines and prove durable writes, restart recovery, peer-loss reads, re-replication, and repair using receipts.
3. Replace sequential multi-peer mutable-reference writes with a reviewed consensus/leader-fencing protocol; a replica majority alone is not proof of linearizable CAS.
4. Finish and test the full blueprint product capabilities: bounties/spec-ad/retainer fulfillment, continuity mesh, true full-duplex assistant behavior, source-fetching/cited research and audio export, media/metaverse tools, and mobile/device compute.
5. Complete platform-specific trust tiers, dynamically replicated revocation/key rotation, threshold governance, privacy-preserving telemetry, and integration of signed release/rollback verification into the live update path.
6. Run required checks on the exact final PR head and independently verify production behavior before enabling checkout or retiring historical persistence sources.

## Safety constraints retained

- No PostgreSQL system-of-record migration is authorized by this tracker.
- No production fallback to local project manifests/media is allowed.
- No live payment activation, deployment, or destructive migration was performed.
- No full-completion or VERIFIED claim is made.