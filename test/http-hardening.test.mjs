import test from "node:test";
import assert from "node:assert/strict";
import { createApexSecurityHeaders, createHttpsOnlyRedirect, isCorsOriginAllowed } from "../src/security/http-hardening.mjs";

test("production CORS never permits arbitrary browser origins, even when the development override is set", () => {
  assert.equal(isCorsOriginAllowed({ origin: "https://trusted.example", allowedOrigins: ["https://trusted.example"], production: true, allowAllCors: true }), true);
  assert.equal(isCorsOriginAllowed({ origin: "https://attacker.example", allowedOrigins: [], production: true, allowAllCors: true }), false);
});

test("development-wide CORS is opt-in and origin matching is exact", () => {
  assert.equal(isCorsOriginAllowed({ origin: "https://attacker.example", allowedOrigins: [], production: false, allowAllCors: true }), true);
  assert.equal(isCorsOriginAllowed({ origin: "https://studio.example.attacker.test", allowedOrigins: ["https://studio.example"], production: false }), false);
  assert.equal(isCorsOriginAllowed({ origin: undefined, production: true }), true);
});

test("security headers add browser protections and prevent API caching", () => {
  const headers = {};
  const response = { setHeader(name, value) { headers[name.toLowerCase()] = value; } };
  let continued = false;
  createApexSecurityHeaders({ production: true })({ path: "/api/ai/generate" }, response, () => { continued = true; });
  assert.equal(continued, true);
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["x-frame-options"], "DENY");
  assert.equal(headers["referrer-policy"], "strict-origin-when-cross-origin");
  assert.equal(headers["cache-control"], "no-store");
  assert.match(headers["strict-transport-security"], /^max-age=31536000/);
});

test("HSTS is not set for local development", () => {
  const headers = {};
  createApexSecurityHeaders({ production: false })({ path: "/" }, { setHeader(name, value) { headers[name.toLowerCase()] = value; } }, () => {});
  assert.equal(headers["strict-transport-security"], undefined);
});


test("production redirects cleartext requests to HTTPS only for configured public hosts", () => {
  const middleware = createHttpsOnlyRedirect({ production: true, publicHosts: ["apex-studio-production.up.railway.app"] });
  let redirect;
  let continued = false;
  const response = { redirect(status, location) { redirect = { status, location }; }, status(code) { this.code = code; return this; }, type() { return this; }, send(body) { this.body = body; } };
  middleware({ headers: { "x-forwarded-proto": "http", host: "apex-studio-production.up.railway.app" }, originalUrl: "/api/auth/session?q=1" }, response, () => { continued = true; });
  assert.deepEqual(redirect, { status: 308, location: "https://apex-studio-production.up.railway.app/api/auth/session?q=1" });
  assert.equal(continued, false);
});

test("production does not redirect internal requests without an edge protocol header", () => {
  let continued = false;
  createHttpsOnlyRedirect({ production: true, publicHosts: ["apex-studio-production.up.railway.app"] })(
    { headers: { host: "apex-studio-production.up.railway.app" }, url: "/health" },
    {},
    () => { continued = true; }
  );
  assert.equal(continued, true);
});

test("production rejects cleartext requests for unconfigured hosts instead of open-redirecting", () => {
  const response = { status(code) { this.code = code; return this; }, type() { return this; }, send(body) { this.body = body; } };
  createHttpsOnlyRedirect({ production: true, publicHosts: ["apex-studio-production.up.railway.app"] })(
    { headers: { "x-forwarded-proto": "http", host: "attacker.example" }, originalUrl: "/" },
    response,
    () => {}
  );
  assert.equal(response.code, 400);
  assert.equal(response.body, "HTTPS required");
});

test("development HTTP requests are not redirected", () => {
  let continued = false;
  createHttpsOnlyRedirect({ production: false })({ headers: { "x-forwarded-proto": "http" } }, {}, () => { continued = true; });
  assert.equal(continued, true);
});


test("production remains provider-neutral when canonical HTTPS hosts are not configured", () => {
  let continued = false;
  createHttpsOnlyRedirect({ production: true })(
    { headers: { "x-forwarded-proto": "http", host: "apex.example" }, originalUrl: "/health" },
    {},
    () => { continued = true; }
  );
  assert.equal(continued, true);
});

import { errorHandler } from "../src/api/middleware.mjs";
import { redact } from "../src/core/privacy.mjs";

test("redaction masks credential-like keys regardless of common casing and separators", () => {
  const result = redact({
    API_KEY: "marker-api",
    access_token: "marker-access",
    refreshToken: "marker-refresh",
    clientSecret: "marker-client",
    nested: [{ Authorization: "marker-auth", password: "marker-pass", harmless: "visible", secretaryName: "visible-too", tokenizedLabel: "also-visible" }]
  });
  assert.equal(result.API_KEY, "[REDACTED]");
  assert.equal(result.access_token, "[REDACTED]");
  assert.equal(result.refreshToken, "[REDACTED]");
  assert.equal(result.clientSecret, "[REDACTED]");
  assert.equal(result.nested[0].Authorization, "[REDACTED]");
  assert.equal(result.nested[0].password, "[REDACTED]");
  assert.equal(result.nested[0].harmless, "visible");
  assert.equal(result.nested[0].secretaryName, "visible-too");
  assert.equal(result.nested[0].tokenizedLabel, "also-visible");
});

test("API error responses and logs do not expose raw exception text or stack", () => {
  const originalError = console.error;
  const logged = [];
  console.error = value => logged.push(String(value));
  const response = {
    code: 0,
    payload: null,
    status(code) { this.code = code; return this; },
    json(value) { this.payload = value; return this; }
  };
  try {
    errorHandler(Object.assign(new Error("credential marker-secret upstream body"), { statusCode: 500, code: "E_UPSTREAM" }),
      { requestId: "req-safe" }, response, () => {});
  } finally {
    console.error = originalError;
  }
  assert.equal(response.code, 500);
  assert.deepEqual(response.payload, { error: "Request failed", requestId: "req-safe" });
  assert.equal(logged.length, 1);
  assert.equal(logged[0].includes("marker-secret"), false);
  assert.equal(logged[0].includes("upstream body"), false);
  assert.equal(logged[0].includes("stack"), false);
});

test("arbitrary client error messages are not reflected to callers", () => {
  const response = { code: 0, payload: null, status(code) { this.code = code; return this; }, json(value) { this.payload = value; return this; } };
  errorHandler(Object.assign(new Error("internal credential marker"), { statusCode: 400 }), { requestId: "req-safe" }, response, () => {});
  assert.deepEqual(response.payload, { error: "Bad request", requestId: "req-safe" });
});

test("redaction masks inline bearer credentials and key-value secret assignments", () => {
  assert.equal(redact("Authorization: Bearer fake-marker-token").includes("fake-marker-token"), false);
  assert.equal(redact("api_key=fake-marker-api").includes("fake-marker-api"), false);
  assert.equal(redact("password: 'fake-marker-password'").includes("fake-marker-password"), false);
});
