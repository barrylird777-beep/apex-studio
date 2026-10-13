# APEX Zero-Trust Baseline

This policy applies to the six canonical app surfaces in this repository: PlanetApeX, KoBlocks, KernelVision, KoinKob, KashKorner, and Kernelodies. It is a baseline, not a claim that every endpoint, dependency, or personal device has already passed a security audit.

## Rules every app must follow

1. **Verify each request.** Network location, same-company hosting, a peer address, CORS approval, a client ID, or a request ID is not identity. Private routes must validate a secret or authenticated principal at the route boundary.
2. **Least privilege.** Use separate credentials for phone controls, workers, opportunity sync, and other service roles. Do not reuse a user-facing secret as a worker secret. Credentials belong in the deployment secret manager, never source control, URLs, logs, or browser bundles.
3. **Fail closed.** If a route requires a credential and its secret is missing, reject the request. Do not silently fall back to anonymous access.
4. **Validate all inputs.** Check app IDs, record IDs, payload types, size limits, allowed operations, and storage namespaces at every trust boundary. Never let a caller choose another person's storage prefix.
5. **Protect personal data.** Send `Cache-Control: no-store` on API responses; do not log tokens, authorization headers, raw private payloads, or personal content. Return generic auth errors.
6. **Secure browser boundaries.** Production browser origins must be explicitly allowlisted. CORS is not authentication; server-to-server requests without an Origin must still pass route authentication.
7. **Protect transport and browser context.** Apply no-sniff, anti-framing, restrictive referrer, and permissions headers. Use HTTPS in production.
8. **Make changes observable.** Use a request ID for safe correlation; do not put secrets or personal data in that ID.
9. **Keep app data separate.** Each canonical app uses its own storage namespace. Cross-app handoffs require an authenticated caller, validated source/target pair, bounded payload, durable idempotency, and an actual peer acknowledgement before reporting delivery.
10. **Test the boundaries.** Add negative tests for missing/invalid credentials, cross-origin requests, invalid IDs, over-size payloads, path traversal, and unauthorized cross-app access.

## Current implementation in this change

- Adds common security headers and per-request correlation IDs.
- Rejects non-allowlisted browser origins in production API requests.
- Disables API response caching.
- Keeps authentication at the route boundary; this middleware does not pretend that CORS or a network address authenticates a caller.

## Required follow-up before calling the whole ecosystem secure

- Inventory every API route and confirm public/private classification.
- Split broad legacy tokens into separate scoped secrets and rotate any secret that may have been exposed.
- Verify authentication on every write, private read, worker operation, upload/download signing endpoint, and cross-app handoff.
- Add rate limits and abuse monitoring to every public expensive endpoint.
- Review SSRF, file path, signed URL, webhook signature, and dependency risks.
- Verify each deployment and each app independently.
- Protect iPhone and other devices through OS updates, strong device passcodes, account MFA, device encryption, and a trusted DNS/content filter. Server code alone cannot install OS protections or secure a phone globally.
