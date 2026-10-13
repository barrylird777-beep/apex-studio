# Apex Parallel Security Program

**Status: engineering contract; not a claim that all controls are implemented or deployed.**

Security runs in parallel with sovereign runtime, network, storage, and six-app work. Protect the owner's authenticated capabilities; do not add arbitrary restrictions or hidden bypasses.

## Invariants
- Owner authority is authenticated, explicit, revocable, and auditable. Never add a public master token or client-bundle secret.
- Treat external users, peers, prompts, uploads, discovered services, and network responses as untrusted.
- PlanetApeX (including GardenApeX), XShield, KernelVision, Kernelodies, KashKorner, and KoinKob keep separate namespaces and authorization.
- Authentication is not authorization. A peer ID, route, app name, or object hash grants no access.
- Fail closed for privileged operations when identity, integrity, or authorization is missing. Do not break intentionally public/read-only flows.
- No destructive cutover before replacement and rollback verification.
- Sovereign target: no PostgreSQL, WAL, local disk as system of record, or persisted JSON records.

## Threat model and controls

| Threat | Required control | Evidence |
|---|---|---|
| Owner account takeover | Strong owner secret, timing-safe comparison, expiring HttpOnly/Secure/SameSite session, bounded sign-in attempts, sign-out and credential rotation | Invalid/valid auth, expiry, cookie, brute-force tests |
| Privilege escalation | Shared guard for every privileged route; never rely on UI-only gating | Route inventory plus anonymous/wrong-token/valid-owner tests |
| Cross-app exposure | Namespace-bound authorization at storage/service boundary; deny by default | Isolation tests across all six apps |
| Rogue peers and replay | Verified peer identity, encrypted authenticated sessions, approved enrollment/revocation, freshness/nonces, bounded messages | Spoof/replay/revocation and two-peer tests |
| Data tampering/rollback | Canonical binary encoding, SHA-256 content integrity, conditional reference updates, encryption for private content, signed release metadata | Tamper/CAS/concurrent-write/restart tests |
| Secret/key theft | Secret injection only, log redaction, no client exposure, rotation procedure | Secret scan, bundle scan, log tests |
| SSRF | Protocol/destination allowlists, block loopback/link-local/private targets unless explicitly required, revalidate DNS and redirects, bound response size/time | IPv4/IPv6, redirect, DNS and timeout tests |
| Browser/session abuse | Exact-origin CORS, CSRF protection for cookie-authenticated mutations, security headers, no-store private API responses | Origin/CSRF/header/browser tests |
| Denial of service | Per-identity fairness, size/deadline/concurrency/queue bounds, cancellation and abuse telemetry; explain and make policy configurable rather than silently limiting owner capabilities | Adversarial load and recovery tests |
| Malicious uploads | Content sniffing, safe names, size/type validation, isolated parsers/transcoders, never execute uploaded content | Traversal/polyglot/oversize/malformed/timeout tests |
| Supply-chain compromise | Lockfile/dependency and secret scans, least-privilege CI, release provenance, artifact verification | CI and release evidence |
| Data loss/malicious deletion | Independent replicas, integrity receipts, versioned recovery and owner-controlled recovery keys | Restore drill and second-peer restart test |
| AI prompt injection/tool misuse | Treat model output as untrusted; explicit tool grants; validate at each privileged boundary; no ambient secret/shell/filesystem authority | Adversarial prompts cannot invoke privileged actions |
| Insider/monitoring gaps | Privacy-minimized audit events for auth, grants, peer changes, denials, object access and releases; never log secrets | Event-coverage and alert/review drills |

## Parallel workstreams
- **S1 Identity:** inventory privileged routes; centralize auth; test sessions, rotation, CSRF, and brute-force controls.
- **S2 Authorization:** capability grants scoped to app + operation + peer; default deny; test cross-app and revoked-peer access.
- **S3 Storage:** binary CAS only after adapter compatibility; encrypt private objects; integrity/CAS checks; independent-peer restart recovery. A new store module alone is not proof of completion.
- **S4 Network:** authenticated encrypted peer transport, replay defense, destination validation, message bounds, timeout and shutdown tests.
- **S5 API/browser:** audit CORS, CSRF, HTTPS trust, headers, uploads, SSRF, and caching.
- **S6 Supply chain/operations:** secret/dependency checks, release provenance, audit coverage, incident recovery, rollback drills.

## Release gates
A. Every route/action inventoried; anonymous and cross-app privileged requests denied.
B. Two peers reject unknown, spoofed, revoked, replayed, malformed, oversized, and timed-out traffic.
C. Private content confidentiality and tamper detection; recovery from another peer after restart; no local fallback.
D. Adversarial API, upload, SSRF, browser-session, and resource-exhaustion tests.
E. Dependency/secret checks, release provenance, recovery and rollback exercise.
F. Repeat all gates on the replacement runtime before traffic cutover.

Record each gate as PASS only with executable test output or captured end-to-end evidence. Missing infrastructure means BLOCKED, never presumed successful.