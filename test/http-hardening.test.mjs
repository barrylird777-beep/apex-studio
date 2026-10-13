import test from "node:test";
import assert from "node:assert/strict";
import { createApexSecurityHeaders, isCorsOriginAllowed } from "../src/security/http-hardening.mjs";

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
