# APEX BELOW-ZERO-TRUST WALL-TO-WALL SECURITY AUDIT

- **Status:** OPEN — preliminary evidence ledger; no system-wide security verdict.
- **Audit baseline:** `main` at `c371b6bdff0f14e5a7c56e5a9c6be09928e0dbe5`.
- **Audit branch:** `security/below-zero-trust-wall-to-wall-20261016`.
- **Repository inventory:** GitHub recursive tree returned 747 tracked files, not truncated.
- **Scope:** all tracked code, tests, workflows, configuration, deployment files, provider adapters, route declarations and mounted routers; six canonical apps; internal services; peer/storage systems; CI/CD and actual deployed runtime evidence.
- **Method:** CHECK → BUILD → VERIFY → TRACK. Preserve originals. No silent canon changes. No production changes during this audit. No merge/deploy without explicit authorization. No secrets in this report.
- **Verdict rule:** do not infer security from names, documentation, green CI, mocks, readiness endpoints, or tests that do not exercise the live boundary. Record each control as Documented / Implemented / Wired / Tested / Deployed / Independently verified.

## Executive status

**BELOW-ZERO-TRUST GATE: OPEN.** This is not a statement that every component is vulnerable; it means the required evidence has not yet established a secure system-wide state.

Repository-visible evidence alone cannot prove production network policy, actual secret values/rotation, cloud IAM, runtime revision, peer-machine independence, data durability after real restarts, or the behavior of external services. These require separately captured runtime/operator evidence.

## Initial repository facts

1. The default branch is `main`, baseline commit `c371b6bdff0f14e5a7c56e5a9c6be09928e0dbe5`.
2. The tree contains 747 tracked files. Largest review surfaces include `server.mjs` (167,851 bytes), `src/workers/apex-2000-worker-fabric.mjs` (171,111 bytes), public app surfaces, storage engines, provider routers, deployment config, workflows and 150 test files.
3. PR #431 (`security/zero-trust-enforcement-gate`, head `5ee16cfef881a3039809ed1d701c824a6bd14510)) remains draft and unmerged. Its description says it adds route-level guards to 55 routes, guards mounted routers, and records unresolved service-identity, runtime, and peer-storage evidence. Those proposed changes do not protect `main` unless independently merged and deployed.
4. PR #637 (`security/openai-max-input-boundary-20261016`, head `45f31df9d3c57591159e2665d242c78acabeddb0)) remains draft and unmerged. Seven recorded workflow runs for that commit report success. This validates only those workflows on that commit; it does not validate `main`, all routes, all services, or production.
5. The current repository contains PostgreSQL-related scripts/migrations and legacy WAL-related variables/paths, including `.env.example`, `package.json`, and `postgres/migrations/`. This is a configuration/canon conflict to trace by live call graph: determine whether each path is active production system-of-record code, migration-only legacy, tests, or dead code. Do not remove or change data paths until usage and recovery are independently established.

## Preliminary findings register

### A-001 — Release-wide route authorization coverage is not proven
- **Severity:** Critical until scoped route-by-route; actual severity depends on reachable operations and route middleware.
- **Evidence:** PR #431 documents 55 direct routes without an obvious route-level guard in its reviewed baseline and includes a route/router guard patch. PR is still draft/unmerged.
- **Risk:** if any sensitive handler is reachable without a verified guard, an unauthenticated caller may invoke state changes, worker actions, private reads, or paid provider calls.
- **Required verification:** enumerate every route in `server.mjs`, every mounted router and nested router; trace inherited middleware; classify public/owner/app/service/peer; run anonymous, wrong-token, wrong-app, expired-session, and valid-owner tests against the live route.
- **State:** documented; not independently verified as exploitable; gate remains open.

### A-002 — Authentication is not yet proof of app/action authorization
- **Severity:** High pending route and service matrix.
- **Evidence:** `src/security/control-plane-auth.mjs` is a shared control-plane gate. Route authentication does not by itself prove that a principal may access a particular app namespace, data object, provider, worker action, or peer operation.
- **Risk:** cross-app access or overbroad privileged operations if handlers rely only on the shared token.
- **Required verification:** build identity × app × action × resource authorization matrix; enforce authorization immediately before each side effect; negative tests for cross-app read/write and worker/peer impersonation.
- **State:** control exists; per-resource enforcement not yet proven.

### A-003 — Owner-session signing key is derived from the owner password
- **Severity:** Medium/High design review.
- **Evidence:** `src/security/owner-session-auth.mjs` derives the session HMAC signing key from a domain-separated SHA-256 of `APEX_OWNER_PASSWORD`; session cookie is HttpOnly and SameSite=Strict.
- **Risk to evaluate:** password rotation invalidates or changes session verification; password entropy and operational rotation become signing-key properties; revocation/rotation and replay behavior require explicit tests. This is not, by itself, proof of a break.
- **Required verification:** inspect token format, expiry, audience/scope, rotation, revocation, replay, cookie secure flags, proxy/TLS assumptions, and recovery workflow.
- **State:** code inspected preliminarily; adversarial verification pending.

### A-004 — Outbound secret screening is pattern-based and not a complete data-loss boundary
- **Severity:** High for sensitive prompts/data; exploitability depends on payload paths.
- **Evidence:** `src/security/sovereign-outbound-gateway.mjs` uses credential-like regexes and secret-bearing field-name checks, plus HTTPS hostname allowlisting and redirect rejection.
- **Risk:** unknown credential formats, private data, personal information, proprietary source, or secrets embedded in unexpected formats may evade pattern screening. Credential screening is not a substitute for app-level data minimization and policy.
- **Required verification:** inventory all outbound destinations and payload builders; test encoded, split, nested, unicode, novel-provider-token, and user-data cases; establish per-app outbound data policy and auditable allowlists.
- **State:** implemented; completeness not established.

### A-005 — Provider selection, system context, response IDs, tools and structured output need one shared enforcement contract
- **Severity:** High pending endpoint call-graph review.
- **Evidence:** `src/providers/unified-ai-router.mjs` has bounded message/prompt handling; direct adapters exist separately. The audit in PR #637 documents caller-supplied model, response IDs, schema metadata, and Grok search flags on direct paths as areas needing review.
- **Risk:** bypassing unified policy, cross-user/app response context, unapproved model/capability selection, tool privilege escalation, or accepting malformed structured output.
- **Required verification:** trace every provider call from route to adapter; enforce fixed model/capability allowlists; bind provider response IDs to authenticated principal and app or disable them; validate structured output against a trusted schema; independently authorize every tool/action.
- **State:** partially implemented; system-wide consistency not proven.

### A-006 — Runtime storage and persistence architecture may conflict with locked storage requirements
- **Severity:** High architectural/canon issue; security/data-loss severity depends on live path.
- **Evidence:** tracked `.env.example` includes legacy WAL variables; `package.json` includes PostgreSQL migration/backup commands; PostgreSQL migrations are tracked; code also includes peer CAS and Pure-WAL modules.
- **Risk:** competing persistence paths, unexpected local/database system-of-record behavior, false durability assumptions, unsafe fallback, or an unverified migration path.
- **Required verification:** call-graph every production write/read; identify actual backend for each app and worker; trace feature flags/fallbacks; test peer identity, replica placement, process restart, peer loss, recovery, and independent physical failure domains. No migration/removal before independently verified recovery.
- **State:** repository fact confirmed; production active-path map not yet complete.

### A-007 — Public status/readiness and metadata exposure needs explicit classification
- **Severity:** Low to Medium unless sensitive operational details are exposed.
- **Evidence:** public status/readiness routes exist in `server.mjs` and mounted routers. Prior audit records identify provider status/catalog endpoints that may reveal configured state/model/capability information.
- **Risk:** unnecessary reconnaissance information or internal topology disclosure.
- **Required verification:** inventory exact unauthenticated response fields; keep only intended public health fields; test that status endpoints do not reveal secrets, internal addresses, identity, detailed errors, or sensitive configuration.
- **State:** endpoints exist; full response inventory pending.

### A-008 — User-controlled HTML rendering requires a complete XSS audit
- **Severity:** High until data sources and escaping are traced.
- **Evidence:** code search found several uses of `innerHTML` in public app files, including `public/kernelodies-library.js`, `public/apex-dashboard.js`, `public/production-room.html`, and other pages. Some surfaces may use escaping or constant templates.
- **Risk:** stored/reflected DOM XSS if untrusted content is interpolated without context-correct escaping.
- **Required verification:** trace every `innerHTML`, `insertAdjacentHTML`, template-string HTML and URL sink to its data source; replace with safe DOM/text APIs or correct context-specific escaping; add malicious input tests.
- **State:** sink inventory partial; no blanket claim of exploitability.

### A-009 — AI-assisted coding can access an OpenAI API key and save run evidence locally
- **Severity:** High data-boundary review.
- **Evidence:** `apex-coder-titan/src/config.mjs` reads `OPENAI_API_KEY`, selects an OpenAI model by default, and defaults `evidenceDir` to a directory under the user's home; `apex-coder-titan/src/ai.mjs` sends input to the provider; `apex-coder-titan/src/titan.mjs` contains secret-pattern scanning for proposed diffs.
- **Risk:** source code, prompts, diffs, logs or evidence could leave the local boundary through provider calls or be retained in local evidence. A secret scanner that checks diffs is not proof that secrets or proprietary content are never transmitted.
- **Required verification:** inspect all request fields, tool definitions, output/log/evidence contents, retention and deletion behavior, model response/tool execution, repo read/write scope, and outbound payload redaction. Test with synthetic secrets and private canary data; confirm exactly what reaches OpenAI and what is retained.
- **State:** integration and default model/key usage confirmed in source; actual production traffic/data flow not independently observed.

### A-010 — Security workflow coverage and trustworthiness must be verified
- **Severity:** High supply-chain gate.
- **Evidence:** repository has many workflows, including dependency/security scanning, CI, deployment, model review and storage verification. A passing workflow run does not establish that all relevant files are scanned or that untrusted pull-request code cannot access privileged secrets.
- **Risk:** missing tests, workflow permission abuse, poisoned build artifacts, dependency compromise, skipped jobs, or deployment of an unverified SHA.
- **Required verification:** inspect every workflow trigger, permissions, secret exposure, third-party action pinning, checkout behavior, artifact provenance, branch protection/rulesets, required checks, environment approvals, and deployment SHA.
- **State:** inventory identified; workflow-by-workflow review pending.

## OpenAI / ChatGPT-specific review — evidence, not speculation

### Confirmed repository behavior
- OpenAI API adapters exist in `src/providers/openai-max-router.mjs`, the unified router, and the separate `apex-coder-titan` application.
- OpenAI model identifiers are configured/defaulted in source, and an `OPENAI_API_KEY` is read from the runtime environment.
- The OpenAI provider path is restricted by the guarded fetch wrapper to `api.openai.com` in the adapter inspected.
- The coding agent can send input to an OpenAI API and stores run evidence under a configurable local directory by default.
- The provider catalog describes OpenAI capabilities. A catalog declaration does not establish those capabilities are enabled, required, or used in production.

### Questions that could affect OpenAI's interests, access, influence or commercial advantage
1. Is OpenAI selected by default or preferred when another provider would meet the request? What exact code/config decides this?
2. What user prompts, uploaded/retrieved content, source code, diffs, personal data, app metadata and tool results are sent to OpenAI?
3. Are OpenAI response IDs or server-side conversation state reused across users or app namespaces?
4. Can OpenAI responses influence provider selection, tool permissions, code changes, deployment, billing or other privileged actions without an independent Apex policy decision?
5. Are OpenAI model names, capabilities, and marketing claims presented as available when they are only catalog entries or defaults?
6. What telemetry, logs, local evidence files, retries, caching, and retention paths exist, and who can access them?
7. Is the product operationally dependent on OpenAI in ways that reduce Apex's provider independence or give OpenAI exclusive access to prompts/data?
8. Do model or provider choices create avoidable API cost, lock-in, or user-data transfer? Are these choices visible and controllable?
9. Does any code send data to OpenAI for a purpose unrelated to the user's requested task?
10. Do repo changes increase OpenAI access or influence without a documented owner decision and explicit data policy?

**No source reviewed so far proves that OpenAI has a hidden backdoor, is receiving all Apex data, or is intentionally manipulating Apex for its own benefit.** Those claims require evidence. The appropriate review is to trace and measure actual data egress, routing, retention, and authority—not infer intent from the existence of an API integration.

## Required proof package before any secure verdict

- Complete tracked-file inventory and reviewed-file ledger with exact SHA.
- Complete direct-route and mounted-router inventory with middleware inheritance.
- Identity, permission, app namespace, service identity and peer authorization matrix.
- AI/provider/tool/action matrix with outbound data inventory and output-validation tests.
- Secret scanning and dependency/supply-chain evidence for the exact release SHA.
- XSS/SSRF/injection/path traversal/deserialization/command execution review of applicable sinks.
- Storage call graph plus real peer identity, replication, restart, failure, repair and recovery evidence.
- Workflow permissions, protected-branch/ruleset, artifact provenance and deployment revision evidence.
- Negative tests for unauthenticated access, wrong app, wrong owner, stale peer, malicious model output, untrusted retrieval, rate-limit bypass and fail-open fallback.
- Runtime evidence from the actual deployed revision, not a mock or source-only assertion.
- Independent reviewer sign-off and unresolved-risk acceptance by the authorized owner.

## Work ledger

| Workstream | Status | Evidence required next |
|---|---|---|
| Repository inventory | Complete snapshot | 747 tracked files at baseline SHA |
| Route/middleware map | In progress | All direct + mounted routes and effective guards |
| Authentication/session | Initial review | Token/session adversarial tests and rotation/revocation |
| AI/provider boundaries | In progress | Direct/unified parity, output/tools, data egress |
| OpenAI-specific impact review | Initial findings captured | Full call graph and synthetic canary egress trace |
| Six-app isolation | Not proven | App/resource permission matrix + negative tests |
| Storage/peer durability | Not proven | Real independent peers, restart/failure/repair receipts |
| Supply chain/CI/CD | Inventory identified | Every workflow, action pin, permissions, release provenance |
| Frontend injection | Partial sink inventory | All HTML/URL sinks traced and adversarially tested |
| Production/runtime | Not proven | Deployed SHA, cloud/network/IAM evidence |
| Overall verdict | **OPEN** | All critical proof gates closed with independent evidence |


## A-006 — additional source-trace findings (2026-10-17)

### Exact production call-path conflict

- `server.mjs` imports the module-level `apexPureStore` and the module-level `sovereignAppFabric`.
- `src/core/sovereign-app-fabric.mjs` defaults to that singleton unless a caller explicitly injects a different store.
- `src/core/apex-pure-store.mjs` selects local `ContentAddressedStore` plus `ApexRingWAL` when the remote flag is false, and selects generic `RemoteContentAddressedStore` when the flag is true but no CAS is injected.
- `src/core/storage.mjs` separately writes project assets and `manifest.json` to `STORAGE_DIR` (default `/srv/apex/se-x/projects`). `src/services/projectManager.mjs` re-exports it; `server.mjs` imports these functions. This is an active source-level path, not just a migration artifact.
- `src/core/sovereign-runtime-daemon.mjs` constructs a separate peer store, `PeerMeshCasAdapter`, `SovereignMeshEngine`, and separate app fabric after runtime peer readiness. The inspected startup path does not inject that adapter into the main server's imported `apexPureStore` singleton.
- The peer runtime is scoped by `APEX_PEER_CAS_NAMESPACE` to one canonical app per runtime. The main app fabric exposes all six apps from one shared store and also stores cross-app/system/worker records. A safe bridge requires a deliberate multi-namespace design and authorization matrix; simply passing one app-scoped adapter into the singleton would not be a valid six-app solution.

### Fail-closed candidate changes and their limitations

The candidate branch now rejects production construction of `ApexPureStore` unless an actual `PeerMeshCasAdapter` is injected, and the adapter now requires an actual `PeerContentAddressedStore` instance rather than an arbitrary object that claims to be peer-owned. The production test file includes negative tests for local fallback and forged/duck-typed adapters. These edits have not been executed locally or confirmed by CI.

**Important — status updated at `650bc347211bdd24dff140bdf0b4c968ff53466b`:** the guard was changed so `ApexPureStore` construction no longer throws during module import. Instead, it records the production storage-policy error and rejects `init()` before any store initialization or persistence work. This removes the import-time crash but does **not** complete production storage wiring: server paths that initialize the store still fail closed until an actual, correctly scoped peer adapter is injected. The six-app namespace facade, local project asset/manifest writes, and live peer recovery remain unresolved. Do not deploy this branch as-is.

### WAL protection nuance

The candidate branch blocks legacy `ApexRingWAL` initialization/writes in production. This protects against accidental new writes through that class but does not by itself prove that all old WAL data has been imported, that no other module writes local files, or that recovery from the old data has been independently verified. Preserve the legacy files and migration logic until checksummed read-back is complete.

### Candidate validation status

- Latest inspected candidate commits include the constructor gate, a concrete peer-adapter type check, and new negative tests.
- The candidate branch has no pull request associated with it yet; the inspected commits have no returned CI workflow runs or combined statuses. This is **not** evidence of passing tests.
- The constructor-policy tests have now been refactored to import the module under test mode first, then switch the child process to production before constructing the candidate store. This should isolate constructor behavior from the module-level singleton, but it remains unverified until CI runs.
- Overall A-006 stays **OPEN** until the server wiring, all six app namespaces, filesystem asset writes, and actual peer restart/failure/recovery have been proven together.


### Preservation correction

The candidate branch's PostgreSQL package-script removal was reversed: the existing `db:generate`, `db:migrate`, `db:studio`, `db:seed`, worker/postgres migration, backup, and TeeVee migration/bootstrap entry points have been restored from `main`. No migration scripts or historical migration sources are to be deleted while their usage and recovery dependencies remain unverified.

The legacy WAL directory/file values have also been retained in `.env.example` as comments explicitly labeled migration-only, rather than erased. They must not be enabled for production writes. This preserves migration provenance while the active path is being replaced.


### Replica failure-domain enforcement tightened

- `PeerContentAddressedStore` now defaults the required failure-domain count to the replica count and rejects multi-replica policies that permit fewer distinct failure domains than replicas.
- Both peer runtime constructors now default `APEX_PEER_CAS_FAILURE_DOMAINS` to the configured replica count instead of `1`.
- A negative test was added for a two-replica policy that would allow both copies to occupy the same failure domain.
- This is a configuration/code guard only. It does not prove the configured labels correspond to physically independent machines, racks, accounts, regions, power domains, or administrators. Operator evidence is still required.

### PR and CI state

A draft PR has been opened to trigger CI and preserve review visibility: [PR #638](https://github.com/barrylird777-beep/apex-studio/pull/638). Current candidate head at this audit point: `f34a96946794d17f14541cac8b7791958ac35b9e`. The workflow runs are queued or pending and the combined status endpoint has no completed status records yet. No passing-check claim is justified. PR #638 is draft, open, and unmerged; it is explicitly not release-ready.
