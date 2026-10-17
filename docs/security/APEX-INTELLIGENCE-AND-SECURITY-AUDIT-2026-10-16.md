# Apex Unified Intelligence and Security Audit

Date: 2026-10-16
Status: WORKING AUDIT — requirements captured; implementation and verification incomplete
Branch: `security/openai-max-input-boundary-20261016`
Related draft PR: #637 — https://github.com/barrylird777-beep/apex-studio/pull/637

## 1. Decisions captured from the design conversation

### Product direction
Apex is intended to combine and exceed the useful capabilities associated with Grok and Google through one unified intelligence platform. This is a product direction, not a claim that the current implementation already achieves feature parity.

Target capabilities include:
- broad research and current-information retrieval;
- reasoning, coding, and multimodal understanding;
- controlled tool use and action workflows;
- a consistent experience across the six canonical apps.

### Provider independence and sovereignty
- Apex-owned policy, identity, permissions, and action authorization must govern the system regardless of the model provider.
- OpenAI, Google, xAI/Grok, and other providers are potential capabilities, not the authority that controls Apex.
- A provider router is one component, not the complete intelligence platform or its security architecture.
- Provider-independent, self-controlled inference and infrastructure must be treated as a target until actual deployment and runtime evidence proves what is available.

### Six-app architecture
Keep the six canonical apps distinct in purpose, identity, permissions, and data namespace:
- PlanetApeX
- XShield
- KernelVision
- KoinKob
- KashKorner
- Kernelodies

Shared backstage infrastructure may support these apps, but shared infrastructure must not imply shared authorization or unrestricted cross-app access. GardenApex remains a universe within PlanetApeX, not a seventh app.

### Security posture
- Treat prompts, retrieved content, uploads, model output, peer messages, repository content, and provider/plugin responses as untrusted until validated.
- Do not let model output itself authorize an action.
- Privileged actions require a separately authenticated, policy-checked authorization path outside the model.
- Apply consistent input, outbound-data, output, tool, and authorization controls across direct provider endpoints and unified-router paths.
- Preserve existing owner privileges and legitimate workflows. Do not lock the owner out or weaken/replace existing behavior without a verified replacement, recovery path, and explicit approval for that specific change.
- Preserve originals and history; do not silently alter locked canon or replace existing security requirements with a new design.
- No destructive production changes during the audit. No secrets in logs, commits, issues, or prompts.
- Do not claim a control is verified based only on documentation, a code change, a mock, or a test fixture. State separately what is implemented, wired to the live path, tested, deployed, and independently verified.

## 2. Current evidence and confirmed gaps

### Direct OpenAI Max route
- On the audited `main` snapshot, `/api/ai/generate-max` uses `requireControlPlaneAuth`.
- The direct route forwards request-provided `system`, `messages`, model, schema fields, and `previous_response_id` to the provider adapter.
- The original OpenAI adapter accepted caller-supplied `system` and `developer` message roles, unlike the stricter unified input policy.
- The adapter uses guarded outbound fetch restricted to `api.openai.com` and outbound payload screening.
- Further checks remain required for response-ID ownership/context binding, model allowlisting, schema and description screening, output validation, safe error reporting, and any direct-route bypass of shared policy.

### Grok direct route
- The direct `/api/ai/generate-grok` route also uses `requireControlPlaneAuth`.
- The original Grok adapter had the same caller-supplied `system`/`developer` role gap and forwarded system instructions without applying the shared outbound credential screening.
- Grok supports optional web/X search tools; their invocation, permissions, data boundaries, and output handling require explicit audit.

### Direct-route follow-up findings (main snapshot)
- `/api/ai/generate-max` and `/api/ai/generate-grok` require control-plane auth for generation, but their paired `/status` routes are public and disclose provider configuration booleans and model names. This is lower-risk metadata, but it needs an explicit public/private decision and response-minimization review.
- The direct OpenAI and Grok handlers log provider exception messages. Their HTTP 502 response bodies are generic, but internal logs can still receive provider or request-derived error strings. Review log redaction and avoid logging raw exception text unless demonstrably sanitized.
- The direct OpenAI/Grok handlers accept caller-supplied `model`, `previous_response_id`, schema objects, schema descriptions, and Grok search-tool flags. Schema size is bounded, but there is no evident per-caller ownership binding for response IDs in these handlers, no fixed model/capability allowlist in the adapters, and no post-parse validation beyond `JSON.parse`. Assess whether response IDs can be reused across user/app contexts and enforce an ownership check or disable caller-supplied IDs if no trusted binding exists.
- `/api/ai/generate` and `/api/ai/collaborate` are control-plane protected. They accept caller-provided system text and provider selection, and the collaborate route accepts caller context. Their complete data flow, per-provider allowlist, request size bounds, and cross-app authorization still require review.
- `/api/ai/catalog`, `/api/ai/providers`, `/api/ai/status`, `/api/apex/universe`, and related status endpoints are public in the reviewed route excerpt. Their output includes provider names, configured state, model names, capability metadata, or execution policy. Treat this as an explicit exposure decision, not automatically as a vulnerability; remove operationally sensitive fields if public access is not intended.
- The authentication middleware uses timing-safe comparison for supplied control tokens and supports owner sessions. Route authorization still needs per-route and per-app policy checks; authentication alone does not establish that a caller may access every app or tool.

### Unified router and mesh providers
- `unified-ai-router.mjs` has a shared role policy that accepts only `user` and `assistant` caller turns; its separate caller `system` context is downgraded to a `user` turn rather than treated as trusted system instructions.
- The unified router advertises OpenAI, Anthropic, Google, xAI, and multiple OpenAI-compatible/search/inference providers. The catalog is breadth of integrations, not proof of feature parity, model availability, provider-specific security, or sovereign inference.
- On the audited `main` snapshot, the direct Gemini mesh adapter and direct Claude mesh adapter screened prompt/system payloads and used guarded provider hosts, but did not explicitly bound prompt/system length or caller-supplied output-token counts. The candidate branch now adds prompt/system bounds, token-count ceilings, and allowlists for Gemini thinking level and Claude effort. These changes remain unverified until the relevant CI checks finish and code review confirms the limits match provider behavior.
- The shared router's Anthropic and Gemini adapters transform normalized messages into provider-specific system fields. Continue to verify that no direct call path can bypass `messagesOf()` and that provider-specific schema/output behavior is validated.
- The outbound gateway detects common credential formats and secret-bearing field names. This is useful screening, not proof that all secrets or personal data can be recognized; data minimization and access controls remain necessary.

### Draft implementation in PR #637
The isolated branch currently includes changes to four provider adapters:
- OpenAI Max and Grok accept only `user` and `assistant` roles in caller-supplied message arrays; separately supplied system instructions are length-bounded and screened through the existing outbound credential scanner.
- Gemini mesh and Claude mesh now bound prompt/system lengths and clamp requested output token counts; Gemini thinking level and Claude effort values are allowlisted.
- Focused regression tests cover role injection, oversized prompts/instructions, and credential-like strings across these adapters.

This is a narrow boundary correction, not completion of the broader security program. The latest CI run was still in progress/pending when last checked. Do not mark tests or CI as passing until final results are read back. PR #637 remains draft and unmerged.

## 3. Audit work still required

### A. Complete provider inventory
Inventory every provider adapter and every direct endpoint. Compare each against one shared policy contract:
- caller roles and trusted instruction construction;
- message, prompt, schema, and metadata size bounds;
- secret/identifier minimization before outbound transmission;
- provider host allowlists and redirect behavior;
- model selection and capability allowlists;
- response ID/context ownership and cross-user isolation;
- structured output parsing and schema validation;
- error handling and redaction;
- retry, timeout, budget, and abuse controls.

### B. Tool and action boundaries
- Enumerate tools and actions available to models and autonomous workers.
- Require per-action authorization outside the model.
- Deny by default for shell, deployment, secret access, permission changes, storage deletion, and other privileged operations unless an explicit policy authorizes the action.
- Validate arguments, target resources, caller identity, app namespace, and authorization immediately before execution.
- Ensure model output is treated as untrusted data and never as proof of authorization.

### C. Routes, identities, and service boundaries
- Enumerate public and internal routes; classify each as public, owner-only, app-scoped, worker-only, or peer-only.
- Verify authentication and authorization on each sensitive route.
- Review status/readiness endpoints for information disclosure.
- Verify distinct, least-privilege app, worker, and peer identities; explicit peer allowlists; lease freshness; and fail-closed behavior.
- Test cross-app read/write denial and owner access to legitimate workflows.

### D. Data, logs, and external retrieval
- Review all outbound provider and search payloads for data minimization and secret screening.
- Review logs for sensitive payloads, credentials, response text, and provider error leakage.
- Treat web search, retrieved documents, uploads, and external instructions as untrusted data.
- Establish provenance and distinguish primary-source facts from summaries, reconstructions, and provisional material.

### E. Deployment and verification
- Read back the exact commit, diff, checks, and deployment revision.
- Run regression, adversarial, negative authorization, isolation, and recovery tests where execution environments permit.
- Confirm CI completion and inspect failures rather than inferring success.
- Verify preview/staging before any production promotion.
- Keep rollback and owner recovery paths.
- Do not merge or deploy without the required authorization.

## 4. Required evidence labels

Every finding must be classified as one or more of:
- **Documented** — requirement appears in a source document.
- **Implemented** — code for the control exists.
- **Wired** — control is called by the actual relevant route/action path.
- **Tested** — named tests executed with observed results.
- **Deployed** — the exact revision is running in the target environment.
- **Independently verified** — evidence beyond the implementation's own assertion confirms behavior.

A control must not be described as complete when only the first or second label applies.

## 5. Immediate status

- PR #637: open, draft, unmerged.
- Current changes: OpenAI Max and Grok role/instruction screening, Gemini and Claude mesh input/token-option bounds, and regression tests.
- CI at last check: all seven workflow runs were still in progress; final outcome not yet verified. The Free Security Baseline secret-scanning job had succeeded, but its dependency audit was still running.
- Production: no deployment or runtime configuration change made by this audit.
- Overall security completion: **OPEN**.
- Overall unified-intelligence product goal: **TARGET DIRECTION; not certified as delivered**.
