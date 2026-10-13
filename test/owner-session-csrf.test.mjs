import test from "node:test";
import assert from "node:assert/strict";
import { createOwnerSessionCsrfGuard } from "../src/security/owner-session-csrf.mjs";

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}
function request(method, origin) {
  return {
    method,
    headers: origin === undefined ? {} : { origin },
    get(name) { return name.toLowerCase() === "origin" ? this.headers.origin : undefined; }
  };
}

test("allows safe methods without applying mutation CSRF checks", () => {
  const guard = createOwnerSessionCsrfGuard({ allowedOrigins: [], hasValidOwnerSession: () => true });
  let continued = false;
  guard(request("GET"), response(), () => { continued = true; });
  assert.equal(continued, true);
});

test("does not replace route authorization for requests without an owner cookie session", () => {
  const guard = createOwnerSessionCsrfGuard({ allowedOrigins: [], hasValidOwnerSession: () => false });
  let continued = false;
  guard(request("POST", "https://attacker.invalid"), response(), () => { continued = true; });
  assert.equal(continued, true);
});

test("allows owner-session mutations from an exact configured origin", () => {
  const guard = createOwnerSessionCsrfGuard({
    allowedOrigins: ["https://apex.example"],
    hasValidOwnerSession: () => true
  });
  let continued = false;
  guard(request("POST", "https://apex.example"), response(), () => { continued = true; });
  assert.equal(continued, true);
});

test("rejects an unconfigured origin for owner-session mutations", () => {
  const guard = createOwnerSessionCsrfGuard({
    allowedOrigins: ["https://apex.example"],
    hasValidOwnerSession: () => true
  });
  const res = response();
  guard(request("DELETE", "https://attacker.invalid"), res, () => assert.fail("must reject"));
  assert.equal(res.statusCode, 403);
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.match(res.body.error, /Origin rejected/);
});

test("fails closed when a cookie-authenticated mutation has no Origin", () => {
  const guard = createOwnerSessionCsrfGuard({
    allowedOrigins: ["https://apex.example"],
    hasValidOwnerSession: () => true
  });
  const res = response();
  guard(request("PATCH"), res, () => assert.fail("must reject"));
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /Origin required/);
});
