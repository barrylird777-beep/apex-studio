# APEX ANCHOR — Phase 1 Monetization and Value Architecture

Status: design baseline; not a claim of production billing or peer durability.

## Non-negotiable runtime laws

- Browser storage is best-effort. IndexedDB quota, eviction, and device loss remain outside APEX's control.
- A peer receipt may claim bytes were written and hash-verified on that peer at a timestamp. It must not claim durable or recoverable storage until an independent peer can retrieve and hash-verify the object in a fresh session.
- Brokers carry signaling/control metadata only. Payload bytes move over negotiated peer data channels where possible.
- If no peer is available, the operation must report unavailable or offer an explicitly consented export. Never silently switch to paid central storage or a local server directory.
- Each canonical app has a distinct namespace and entitlement audience. Shared transport does not grant cross-app data access.
- Payment is optional and explicit. No dark patterns, surprise charges, or charges for access to a user's own data.
- CI validates before deployment; deployments are not called successful until a live health and functional smoke test passes.

## Canonical apps and value loops

| Canonical app | Free client/peer value loop | Explicit premium conversion |
|---|---|---|
| PlanetApeX | Bible reading/study, research organization, source catalog browsing, notes and lightweight local analytics | User opts into a clearly priced compute-heavy research run, publishing package, or advanced analysis |
| XShield | Client-side tracker/ad filtering, privacy settings, DNS configuration generation and local diagnostics | User opts into an advanced protection/managed rules service only if a real service cost exists |
| KernelVision | Media organization, project planning, browser previews, lightweight edits and peer-assisted transfers | User requests a premium render, advanced production pipeline or export profile |
| Kernelodies | Playback, playlists, library organization, discovery and user-owned audio metadata | User opts into advanced creation/mastering tools or a clearly priced artist workflow |
| KashKorner | Local budgeting/calculation, transaction preparation, receipt organization and user-controlled data exchange | User explicitly requests a priced transaction, market or monetization service; disclose third-party fees |
| KoinKob | Local simulations, worker/account experiments, market models and peer-shared public datasets | User opts into premium simulations, advanced strategy analysis or a paid execution service |

The free loop must remain useful. The conversion trigger is the user's request to execute a named premium operation, before work or third-party cost is incurred. Never charge just to open the app or retrieve user-owned content.

## Stateless billing design

1. Client requests a checkout session from an edge/serverless endpoint with an allowlisted app ID, price ID and return URL.
2. Endpoint creates the Stripe Checkout Session using server-held Stripe credentials. No client-supplied amount is trusted.
3. Stripe sends a webhook. Verify the raw request body using Stripe's webhook-signing secret before acting on the event.
4. After redirect, a token-issuance endpoint retrieves the Checkout Session from Stripe and verifies payment status, currency, expected price, app audience and customer/session metadata against server policy.
5. Sign a short-lived entitlement token with an Ed25519 private key held only in edge secrets. Browser apps embed only the public verification key.
6. Client verifies signature, issuer, app audience, entitlement, issued-at, expiry and product/version locally before unlocking the premium action.
7. Do not store card data. Keep no paid database. A webhook is not itself proof that the browser's current user owns an entitlement.

### Stateless limits that must remain explicit

- Without a persistent revocation ledger, already-issued tokens cannot be instantly revoked. Use short expiries and re-check Stripe before issuing renewals or new tokens.
- Do not embed Stripe secret keys, webhook secrets, or signing private keys in browser code.
- Checkout success redirects alone are not proof of payment.
- Webhook retries must be safe. Stateless processing cannot promise database-backed exactly-once semantics; use deterministic entitlement claims and Stripe-side status checks.
- A signed license proves an issuer made a claim; it does not prove ongoing payment status beyond its validity window.

## Phase 1 acceptance gates

- [ ] All six app IDs match `src/apps/apex-six-apps.mjs`.
- [ ] Every premium trigger is opt-in and shown before execution.
- [ ] No free loop depends on a paid central database or storage bucket.
- [ ] Peer storage receipts distinguish write verification from recovery verification.
- [ ] Entitlements are audience-bound to one canonical app and short-lived.
- [ ] Stripe webhook signatures are verified on the server using the raw body.
- [ ] Secrets remain server-side; no client-trusted price or entitlement fields.
- [ ] CI tests signature tampering, wrong-app tokens, expiry, unpaid sessions and peer unavailability.
- [ ] No production claim is made until tests and live checks pass.

## Phase 2/3 sequencing

1. Audit existing IndexedDB worker, content-addressed store, and WebRTC proof before replacing anything.
2. Add encrypted chunk manifests and per-chunk integrity checks without representing browser storage as permanent.
3. Extend the existing manual WebRTC proof into bounded transfer messages; keep signaling payload-only-free.
4. Implement stateless entitlement verification and Stripe endpoints behind environment-gated configuration.
5. Ship Apex Studio capabilities under the current canonical ownership rules: production/rendering features belong to KernelVision; Apex Studio is a historical umbrella name, not a seventh app.
