# Zero-Trust Release Gate

**Status: OPEN — production zero-trust completion is not yet proven.** This document is a release blocker, not a declaration of compliance.

## Plain-language rule

Every request must prove it is allowed at the service that receives it. Being inside the Apex network, coming from another app, carrying an AI-generated explanation, or having passed CORS is not proof of permission. Each route must be protected or deliberately public for a documented reason. Every service-to-service call must authenticate the calling service. AI agents may suggest or implement changes, but they cannot grant themselves permission or approve their own security work.

## Evidence currently found in source

- The shared control-plane middleware compares a shortcut/control token and fails closed if neither is configured.
- Internal worker routes have a separate worker-token check.
- Opportunity Engine routes use configured opportunity-engine tokens.
- The sovereign peer transport uses encrypted libp2p Noise and an explicit peer-ID allowlist.
- AI message normalization rejects caller-supplied system/developer/tool roles and limits message sizes.
- The HTTP hardening module adds browser security headers and prevents arbitrary origins from being allowed in production CORS.

These are useful controls. They are **not** proof that every API, app, provider, worker, or deployment has the right guard.

## Release blockers to close

1. **Complete route inventory:** enumerate all API routes from `server.mjs` and mounted routers. Every route must be marked user-authenticated, service-authenticated, or public-by-design with a reason and abuse controls. The initial scan found 149 direct `app.*` registrations; 59 did not show an auth/rate-limit marker. On the security branch, 55 direct routes received receiver-side control-plane authorization, the detailed health snapshot is now protected, and relay/audio/TeeVee mounted routers gained receiver-side guards. A static scan of 143 direct API/readiness routes currently finds zero unclassified routes, and a test checks the known mounted-router boundaries. This is source-level evidence pending full CI and runtime verification—not production certification.
2. **Distinct service identities:** verify every app-to-app and worker-to-worker boundary. A shared control-plane token is not the same as distinct per-service identity. Document caller, receiver, credential/identity, scope, rotation, timeout, and denial behavior.
3. **AI/provider boundary:** inventory every model/provider/tool call, the data it may receive, its allowed actions, and the validation applied to its output. AI output must never be treated as authorization.
4. **Peer boundary:** prove allowlist enforcement and authenticated peer identity on every production message path. Browser WebRTC's manual test is not the production mesh identity system.
5. **Secrets and deployment configuration:** check that production services have required credentials, no secrets are in URLs or logs, missing secrets fail closed, and the deployed commit/configuration matches the reviewed version. Do not print secret values into CI logs.
6. **Negative tests:** prove missing, wrong, expired/replayed (where relevant), and insufficient-scope credentials are denied for each boundary. Positive tests alone are insufficient.
7. **Runtime evidence:** test the deployed API and service connections, including denial behavior, and record the deployed commit and configuration presence without exposing secret values.

## Required completion evidence

- A reviewed route inventory with zero unclassified routes.
- A service-to-service identity matrix with zero unverified boundaries.
- AI/provider/tool permission inventory and deterministic output validation.
- Automated deny tests for each protected boundary.
- Passing security gates on the exact release commit.
- Production smoke evidence for that same deployed commit.
- An explicit residual-risk list. Any unverified item means the gate stays OPEN.

## Agent rules

All human and AI contributors must follow this gate. No agent may waive it, declare its own work secure, bypass required tests, or resume unrelated feature work while the gate is open. Report blockers plainly; never equate CI green, a bounded model check, or one protected endpoint with whole-system zero trust.
