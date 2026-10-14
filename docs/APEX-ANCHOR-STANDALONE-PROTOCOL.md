# APEX ANCHOR: Standalone Sovereign Compute Protocol

Status: architecture and productization plan; **not a production-readiness claim**.

## Product boundary

APEX ANCHOR is the infrastructure protocol. The six APEX apps are clients:
- KernelVision
- XShield
- Kernelodies
- PlanetApeX
- KashKorner
- KoinKob

The node must run without importing app UI, app-specific routes, consumer identity flows, or app-owned persistence. Tenant and app identity are explicit protocol inputs, not hard-coded transport destinations.

## Node responsibilities

1. **Peer identity and encrypted transport** — authenticated peer identity, encrypted sessions, replay protection, bounded resource use, and explicit trust/bootstrap configuration.
2. **Peer content-addressed model distribution** — manifests declare exact file paths, lengths, digests, tokenizer/config requirements, model revision, and tenant namespace. Verify each shard before passing it to the engine.
3. **Inference adapter** — a narrow local adapter for vLLM over a private Unix-domain socket. The socket is an internal process boundary, not a network trust boundary; authenticate callers and restrict filesystem permissions.
4. **Policy enforcement** — deny external model-provider egress in sovereign-only mode, fail closed on unknown inference origins, disable redirects, and audit all SDK/direct-fetch paths. Web search and other explicitly requested network capabilities are separate policies, not inference fallbacks.
5. **Lifecycle and recovery** — readiness only after a real peer-to-engine round trip; bounded shutdown; peer-loss recovery; deterministic cleanup; and explicit behavior when required shards are unavailable.
6. **Operator interface** — health/readiness, capacity, peer status, model inventory, and proof records without prompt content, credentials, or sensitive model bytes.

## Deployment package

Deliver an operator-owned node package with:
- a minimal runtime image pinned by immutable digest, or a static executable only if all required native dependencies can actually be bundled;
- an unprivileged runtime user, read-only root filesystem where compatible, dropped Linux capabilities, seccomp, resource limits, and no package manager in the final image;
- no default cloud object store, managed database, telemetry collector, external AI API, or paid service dependency;
- explicit host configuration for GPU access, peer keys, tenant namespaces, trusted bootstrap multiaddresses, model policy, and socket paths;
- offline installation and signed-update/rollback instructions.

Do not claim “distroless” until the final image is actually built, inspected, and exercised. Do not claim “no disk writes” until runtime tracing and crash/restart tests show exactly what the engine, container runtime, driver, and operator configuration write. vLLM and GPU drivers may create caches or temporary files unless explicitly configured and verified.

## Required protocol acceptance gates

A release is not production-ready until all of the following have evidence attached to the release:
1. Unit tests and the canonical CI suite pass on the exact release commit.
2. Image builds reproducibly; final image is scanned and contains no shell/package manager if described as distroless.
3. Two independently controlled peers establish authenticated encrypted sessions and reject wrong identities, replayed messages, unauthorized tenants, and malformed manifests.
4. Model shards are digest/length-checked; tampering is rejected; missing peers trigger deterministic recovery or a clear failure.
5. A real GPU/vLLM startup loads a model through the peer path; inference returns a valid result; restart and peer-loss recovery are exercised.
6. Sovereign-only mode is tested against every inference route, SDK, direct HTTP client, redirect, fallback, and retry path. Packet capture or an equivalent egress test proves no prompt leaves the trusted subnet.
7. Persistence and memory behavior are measured. “RAM-only” is a verified deployment profile, not an assumption from using a Unix socket.
8. Tenant isolation, key rotation, revocation, abuse limits, capacity exhaustion, and incident recovery are tested.
9. Independent security review and a threat model cover peer compromise, malicious operators, model poisoning, GPU side channels, and control-plane compromise.

## DePIN and settlement: separate, later phase

Do not couple token settlement to the core compute dataplane. First prove private, operator-controlled deployments. A settlement adapter may later accept signed usage receipts containing job ID, tenant, model digest, peer identities, metered units, timestamps, and nonce—never prompts or generated content.

A receipt is not proof of correct computation by itself. Before operator payouts, define a verifiable workload, anti-replay rules, disputes, slashing/chargeback policy, and independent validation. Benchmark-based proof-of-compute, trusted execution, redundancy, or challenge-response may be needed depending on the threat model.

USDC payment is not inherently zero-fee: chain gas, exchange/on-ramp costs, compliance, failed transactions, and accounting remain. Support stable invoices and settlement only after selecting a chain and measuring end-to-end costs. Never advertise zero-fee settlement without evidence.

## Commercial validation

Treat any hourly rate or $30k–$50k/month private-subnet price as a hypothesis, not an established market rate. Benchmark actual hardware utilization, power, bandwidth, support, redundancy, compliance, and recovery costs. Start with a paid design-partner pilot and a written service boundary. Do not promise “impenetrable,” absolute secrecy, or regulated-industry suitability without independent audit and contractual controls.

## Current known blockers

The peer-CAS/vLLM implementation has not yet demonstrated the full acceptance path. The production daemon/store authorization context, single-use handshake, exact runtime/image verification, test results, live GPU loading, and two-peer recovery must be closed and recorded before public claims of a verified sovereign compute engine.
