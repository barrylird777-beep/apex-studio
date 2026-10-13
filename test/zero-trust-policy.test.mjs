import test from "node:test";
import assert from "node:assert/strict";
import { createApexZeroTrustPolicy } from "../src/security/zero-trust-policy.mjs";

function harness({ production = true, allowedOrigins = ["https://apex.example"], path = "/api/private", method = "GET", headers = {} } = {}) {
  const written = {};
  let statusCode = 200;
  let payload;
  let nextCalled = false;
  const req = { path, method, headers };
  const res = {
    setHeader(name, value) { written[name] = value; },
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; }
  };
  const next = () => { nextCalled = true; };
  createApexZeroTrustPolicy({ production, allowedOrigins, makeRequestId: () => "req-test" })(req, res, next);
  return { req, written, statusCode, payload, nextCalled };
}

test("sets baseline security headers and disables API caching", () => {
  const result = harness({ headers: { origin: "https://apex.example" } });
  assert.equal(result.nextCalled, true);
  assert.equal(result.written["X-Request-ID"], "req-test");
  assert.equal(result.written["X-Content-Type-Options"], "nosniff");
  assert.equal(result.written["X-Frame-Options"], "DENY");
  assert.equal(result.written["Cache-Control"], "no-store");
  assert.equal(result.written["Strict-Transport-Security"], "max-age=15552000; includeSubDomains");
});

test("rejects unapproved browser origins in production", () => {
  const result = harness({ headers: { origin: "https://attacker.example" } });
  assert.equal(result.statusCode, 403);
  assert.equal(result.nextCalled, false);
  assert.equal(result.payload.requestId, "req-test");
});

test("allows an approved origin in production", () => {
  const result = harness({ headers: { origin: "https://apex.example" } });
  assert.equal(result.nextCalled, true);
});

test("does not treat a missing Origin as authentication", () => {
  const result = harness({ headers: {} });
  assert.equal(result.nextCalled, true);
  // The downstream route must still authenticate private data and all writes.
});

test("keeps local development usable without production origin enforcement", () => {
  const result = harness({ production: false, headers: { origin: "http://localhost:5173" } });
  assert.equal(result.nextCalled, true);
});
