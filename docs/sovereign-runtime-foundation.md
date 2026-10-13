# Apex Sovereign Runtime Foundation

**Status: implementation contract, not a claim that migration is complete.**

## Objective

Make the six canonical Apex apps operate on an Apex-controlled runtime and authenticated peer network. Hosting companies may temporarily provide compute, but their proprietary control planes must not become required application architecture. Do not disable a working deployment until a replacement passes the acceptance gates below.

## Canonical boundaries

The only canonical apps are PlanetApeX, XShield, KernelVision, Kernelodies, KashKorner, and KoinKob. GardenApex is the living world inside PlanetApeX, not a seventh app. Shared transport does not imply shared authorization: every app keeps its own identity, namespace, access policy, and audit trail.

## Runtime planes

1. **Control plane:** owner-authenticated commands, peer enrollment/revocation, configuration, signed releases, and health reporting. It must not expose owner controls publicly without authentication.
2. **Execution plane:** the HTTP/API process, sovereign runtime daemon, and separately supervised workers. Readiness must reflect an actual runtime packet round-trip, storage verification, and successful dispatch—not merely an open HTTP port.
3. **Network plane:** encrypted libp2p sessions, explicit peer identity, allowlisted enrollment, bounded messages, replay protection, and measured acknowledgements. Discovery is not authorization; a queued message is not delivery.
4. **Storage plane:** an injected remote/peer-owned binary backend, immutable content IDs, integrity verification, encrypted private content, replica receipts, and recovery checks. Never silently fall back to a local directory.
5. **App plane:** six independent app namespaces and least-privilege capability grants. A peer authorized for one app must not automatically read another app's objects.

## Hard constraints

- No PostgreSQL, WAL, local disk as the system of record, or persisted JSON records.
- Do not add a paid dependency or require a new subscription.
- Do not claim free compute, always-on availability, storage capacity, or public reachability until an actual resource and end-to-end test prove it.
- No destructive cutover. Preserve the current working deployment until the replacement passes the gates.
- Keep TLS for public browser/API traffic and authenticated encrypted transport for peer traffic. Never expose private keys in source, logs, URLs, or client bundles.
- Keep the iPhone as the phone-first control surface; do not assume iOS can host an always-on server in the background.

## Migration sequence

### Gate 0 — inventory and safety
Record current service entry points, environment variables, storage adapters, peer identities, app routes, and live endpoints. Identify every vendor-specific hostname, deployment assumption, and storage fallback. Do not migrate or delete user data during inventory.

### Gate 1 — provider-neutral boot
Define one documented runtime entry point with explicit configuration validation. Separate public HTTP readiness from sovereign-network readiness. Fail closed when mandatory identity, authorization, or storage configuration is missing. Vendor-specific behavior must be opt-in configuration rather than a hard-coded default.

### Gate 2 — peer proof
Run two independently started peers with distinct stable identities. Verify authenticated handshake, bidirectional challenge/response, bounded transfer, checksum equality, rejection of an unapproved peer, and accurate timeout/failure reporting. Capture test evidence.

### Gate 3 — storage proof
Use an explicitly injected peer-owned binary backend. Write an encrypted test object, verify its content hash from a second peer, restart both peers, and verify recovery without relying on local disk. Prove namespace isolation across all six app names. If no reachable backend exists, report the gate as blocked; do not fake persistence.

### Gate 4 — six-app proof
Exercise a real route and an isolated read/write test for each canonical app. Verify owner-only controls, least-privilege access, and no cross-app reads by default.

### Gate 5 — cutover
Only after Gates 0–4 pass: run the replacement alongside the old service, verify public HTTPS and iPhone access, then switch traffic. Keep rollback instructions and preserve the old deployment until the new service has passed a defined observation window.

## Current known gaps

The repository's existing code includes a sovereign runtime, libp2p peer transport, a remote content-addressed store, and a runtime-readiness gate. Their presence is not proof of complete sovereignty. The repository architecture notes that WAL/local-store paths remain and that the current remote CAS encodes objects/manifests as JSON, which conflicts with the hard constraints above. These must be replaced or disabled with tests proving no production path can reach them before declaring the storage plane compliant.

## Completion evidence

A gate is complete only with executable tests or captured end-to-end results. Architecture documents, healthy HTTP status alone, configured peer addresses, successful builds, or a queued job do not count as proof of live peer delivery, durable persistence, or public availability.
