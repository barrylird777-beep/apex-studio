import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateApexZeroTrust,
  createApexZeroTrustGuard,
  apexZeroTrustFingerprint
} from "../src/security/apex-zero-trust.mjs";

const now = 1_800_000_000_000;
const principal = overrides => ({
  id: "peer-verified-17",
  authenticated: true,
  identityVerified: true,
  active: true,
  expiresAt: now + 60_000,
  capabilities: ["read:network-status"],
  ...overrides
});

function response() {
  return {
    statusCode: null, body: null, headers: {},
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test("Zero Trust allows only a verified, active, unexpired identity with the exact capability", () => {
  assert.deepEqual(
    evaluateApexZeroTrust({ principal: principal({}), action: "read", resource: "network-status", now }),
    { allowed: true, status: 200, reason: "explicit_capability_match", principalId: "peer-verified-17" }
  );
});

test("Zero Trust fails closed when action or resource is missing", () => {
  assert.equal(evaluateApexZeroTrust({ principal: principal({}), action: "read", now }).reason, "policy_not_specific");
  assert.equal(evaluateApexZeroTrust({ principal: principal({}), resource: "network-status", now }).reason, "policy_not_specific");
});

test("Zero Trust rejects absent, unverified, and inactive identities", () => {
  assert.equal(evaluateApexZeroTrust({ action: "read", resource: "network-status", now }).status, 401);
  assert.equal(evaluateApexZeroTrust({ principal: principal({ identityVerified: false }), action: "read", resource: "network-status", now }).status, 401);
  assert.equal(evaluateApexZeroTrust({ principal: principal({ active: false }), action: "read", resource: "network-status", now }).status, 401);
});

test("Zero Trust rejects expired identities and identities without an expiry", () => {
  assert.equal(evaluateApexZeroTrust({ principal: principal({ expiresAt: now }), action: "read", resource: "network-status", now }).reason, "identity_inactive_or_expired");
  assert.equal(evaluateApexZeroTrust({ principal: principal({ expiresAt: undefined }), action: "read", resource: "network-status", now }).status, 401);
});

test("Zero Trust requires an exact capability and does not treat wildcards as grants", () => {
  assert.equal(evaluateApexZeroTrust({ principal: principal({ capabilities: ["read:*"] }), action: "read", resource: "network-status", now }).status, 403);
  assert.equal(evaluateApexZeroTrust({ principal: principal({ capabilities: ["write:network-status"] }), action: "read", resource: "network-status", now }).status, 403);
});

test("HTTP guard fails closed, disables caching, and emits a redacted audit decision", () => {
  const events = [];
  const guard = createApexZeroTrustGuard({
    action: "write", resource: "kernelvision-project",
    clock: () => now, audit: event => events.push(event)
  });
  const res = response();
  guard({ id: "request-1", headers: { authorization: "secret-must-not-be-logged" } }, res, () => assert.fail("unverified request must not pass"));
  assert.equal(res.statusCode, 401);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(res.headers.vary, "Authorization");
  assert.equal(JSON.stringify(events).includes("secret-must-not-be-logged"), false);
  assert.equal(events[0].principalId, undefined);
  assert.equal(events[0].principalFingerprint, null);
  assert.equal(events[0].reason, "identity_not_verified");
  assert.equal(events[0].requestId, undefined);
  assert.equal(events[0].requestFingerprint, apexZeroTrustFingerprint("request-1"));
  assert.equal(JSON.stringify(events).includes("request-1"), false);
});

test("HTTP guard passes a verified principal with an exact capability", () => {
  const guard = createApexZeroTrustGuard({
    action: "read", resource: "network-status", clock: () => now
  });
  let passed = false;
  const res = response();
  guard({ id: "request-2", apexPrincipal: principal({}) }, res, () => { passed = true; });
  assert.equal(passed, true);
  assert.equal(res.statusCode, null);
});

test("audit fingerprints are stable and do not expose the original identifier", () => {
  const first = apexZeroTrustFingerprint("peer-secret-id");
  assert.equal(first, apexZeroTrustFingerprint("peer-secret-id"));
  assert.notEqual(first, "peer-secret-id");
  assert.equal(first.length, 16);
});
