# APEX ANCHOR — Defense-in-Depth Baseline

Status: audit baseline; no production configuration changed.

## Scope

Protect the six canonical apps — KernelVision, XShield, Kernelodies, PlanetApeX, KashKorner, and KoinKob — plus the network, storage, deployment control plane, AI integrations, and the owner's iPhone.

## Verified observations (2026-10-13)

- Railway project `helpful-laughter` has four live services: `apex-studio`, `apex-studio-foundation`, `apex-workers`, and `apex-sovereign-peer-2`.
- Those four services reference the same GitHub repository, `barrylird777-beep/apex-studio`.
- The production environment lists two 500 MB volumes with no mounted service.
- An object-storage bucket named `apex-media-vault` exists.
- A separate Railway project named `music-radar` contains a Postgres service.
- No staged changes were present in either inspected production environment.
- These observations do not establish compromise or prove that the six apps have six independent security boundaries.

## Non-negotiable safety rules

1. No destructive production changes during the audit.
2. Never expose secrets in logs, commits, issue comments, or AI prompts.
3. No credential rotation until consumers and rollback/recovery are identified.
4. No app-to-app trust based only on network location.
5. No AI-generated action may directly change infrastructure, secrets, permissions, or persistent data without a separately authenticated, policy-checked authorization path.
6. Fail closed for missing identity, invalid signatures, unknown peers, stale leases, and policy errors.
7. Keep each app's data namespace and permissions isolated; shared infrastructure does not imply shared authorization.
8. No claim of phone protection from server-side changes alone.
9. **Preserve the owner's privileges and abilities.** Do not lock the owner out, revoke owner access, narrow legitimate owner capabilities, disable features, or change authentication/authorization behavior without a verified replacement path and explicit approval for that specific change.
10. Security controls must be additive where possible. If a proposed control could block a legitimate owner workflow, test it in isolation and document the recovery route before considering production promotion.
11. Never disable security checks merely to make a test pass; repair the policy or the test based on evidence.

## Required hardening gates

### Identity and authorization
- Enumerate every public route and classify it as public, owner-only, app-scoped, worker-only, or peer-only.
- Verify each sensitive route has an explicit authentication and authorization guard.
- Use distinct, revocable, least-privilege identities for apps, workers, and peers without reducing the owner's existing authorized control.
- Require authenticated peer identity plus an explicit peer allowlist; reject unknown or expired peer leases.
- Audit session lifetime, cookie attributes, CSRF exposure, login throttling, and credential rotation/revocation.
- Test owner access to existing legitimate functions before and after each candidate change; include a rollback/recovery test.

### AI and tool boundaries
- Treat prompts, model output, retrieved documents, uploads, and peer-supplied payloads as untrusted data.
- Enforce tool allowlists and per-action authorization outside the model.
- Block model-originated shell, deployment, credential, and storage-delete operations unless a separate policy gate authorizes them.
- Minimize data sent to external providers; redact secrets and personal identifiers where feasible.
- Log security decisions without logging secrets or sensitive payload bodies.

### Network and service isolation
- Inventory public domains, exposed ports, route mappings, service-to-service dependencies, and egress destinations.
- Restrict administrative/control-plane endpoints; no unauthenticated management surface.
- Verify TLS, origin policy, rate limits, request size limits, timeouts, and safe error handling.
- Test that compromise of one app identity cannot read or write another app's namespace.

### Storage and recovery
- Identify the active system of record and prove where writes actually land before changing storage.
- Verify encryption, least-privilege object-storage credentials, immutable content hashes, integrity checks, and backup/restore.
- Determine why the listed volumes are unattached; do not mount or delete them without tracing dependencies.
- Test namespace isolation, unauthorized reads/writes, tampering detection, and recovery from a clean peer.

### Deployment and supply chain
- Confirm branch protections, required checks, dependency audit status, secret scanning, and deployment provenance.
- Deploy candidate hardening changes to an isolated preview/staging environment first.
- Require regression tests and observable readiness checks before promotion.
- Keep a tested rollback path and preserve current production revisions.

### Owner's iPhone
- Review Apple account sessions/devices and remove only devices the owner does not recognize.
- Use a unique passcode, current iOS, two-factor authentication, and a password manager.
- Keep Lockdown Mode as a risk-based option if the owner believes they are a targeted individual.
- Install only trusted configuration profiles/VPNs; inspect and remove profiles the owner does not recognize.
- Use a reputable encrypted DNS/content-blocking profile only after reviewing the provider and its trust model.
- Server hardening cannot inspect or guarantee the security of the physical phone.

## Exit criteria

Do not declare APEX ANCHOR complete until all six canonical apps have a verified access matrix; peer and app isolation tests pass; storage integrity and restore are demonstrated; deployment and rollback are documented; the iPhone checklist is completed by its owner; and all findings have evidence, severity, owner, and remediation status.
