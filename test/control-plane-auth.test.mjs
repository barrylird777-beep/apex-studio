import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createControlPlaneAuth } from "../src/security/control-plane-auth.mjs";

function makeResponse() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; }
  };
}

function makeRequest(headers = {}, pathname = "/api/oracle") {
  return {
    method: "POST",
    path: pathname,
    originalUrl: pathname,
    get(name) { return headers[String(name).toLowerCase()] || ""; }
  };
}

test("control-plane auth fails closed when no token is configured", () => {
  const auth = createControlPlaneAuth({ getExpectedToken: () => "" });
  const response = makeResponse();
  auth(makeRequest(), response, () => assert.fail("request should not pass"));
  assert.equal(response.statusCode, 503);
  assert.equal(response.headers["cache-control"], "no-store");
});

test("control-plane auth rejects wrong tokens and accepts the existing phone-control header", () => {
  const auth = createControlPlaneAuth({ getExpectedToken: () => "correct-secret" });
  const denied = makeResponse();
  auth(makeRequest({ "x-apex-shortcut-token": "wrong" }), denied, () => assert.fail("wrong token should not pass"));
  assert.equal(denied.statusCode, 401);
  assert.equal(denied.headers["cache-control"], "no-store");

  const accepted = makeResponse();
  let nextCalled = false;
  auth(makeRequest({ "x-apex-shortcut-token": "correct-secret" }), accepted, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(accepted.statusCode, null);
});

test("control-plane auth accepts a bearer token without exposing it in the URL", () => {
  const auth = createControlPlaneAuth({ getExpectedToken: () => "correct-secret" });
  const response = makeResponse();
  let nextCalled = false;
  auth(makeRequest({ authorization: "Bearer correct-secret" }, "/api/render/export"), response, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test("high-cost API routes require control-plane auth and public flows remain explicitly rate-limited", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const home = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const bridge = await readFile(new URL("../public/api-auth-bridge.js", import.meta.url), "utf8");
  const protectedRoutes = [
    ["post", "/api/oracle"],
    ["post", "/api/forge"],
    ["post", "/api/audio"],
    ["post", "/api/media/image"],
    ["post", "/api/media/video"],
    ["post", "/api/render/export"],
    ["post", "/api/ai/generate-max"],
    ["post", "/api/ai/generate-grok"],
    ["post", "/api/ai/generate/:provider"],
    ["post", "/api/ai/generate"],
    ["post", "/api/ai/collaborate"],
    ["post", "/api/mesh/jobs"],
    ["post", "/api/crew/jobs"],
    ["post", "/api/crew/burst"],
    ["post", "/api/korn-knob/ideas"],
    ["post", "/api/korn-knob/ideas/evaluate"],
    ["post", "/api/korn-knob/worker-job"],
    ["patch", "/api/engine-apex/chat-runtime/state"],
    ["post", "/api/engine-apex/chat-runtime/events"],
    ["post", "/api/engine-apex/brief"],
    ["post", "/api/network/rogue-ap/trust"],
    ["post", "/api/network/rogue-ap/revoke"],
    ["post", "/api/network/rogue-ap/observations"]
  ];
  for (const [method, route] of protectedRoutes) {
    assert.ok(server.includes("app." + method + "('" + route + "', requireControlPlaneAuth,"), method.toUpperCase() + " " + route + " must require control-plane auth");
  }
  assert.match(server, /app\.get\(['"]\/api\/health['"],/);
  assert.match(server, /app\.get\(['"]\/api\/canon\/apps['"],/);
  assert.match(server, /app\.get\(['"]\/api\/search['"],/);
  assert.match(home, /api-auth-bridge\.js/);
  assert.match(bridge, /apex\.phone\.sessionToken/);
  assert.match(bridge, /x-apex-shortcut-token/);
  for (const page of ["production.html", "shield-apex.html", "engine-apex.html", "korn-knob.html", "teevee.html"]) {
    const html = await readFile(new URL("../public/" + page, import.meta.url), "utf8");
    assert.match(html, /api-auth-bridge\.js/, page + " must use the shared auth bridge");
  }
  assert.match(server, /app\.post\(['"]\/api\/paypex\/brief['"],\s*requirePublicRequestSlot,\s*express\.json/);
  assert.match(server, /app\.post\(['"]\/api\/rapid\/preview['"],\s*requirePublicRequestSlot,/);
  assert.match(server, /app\.post\(['"]\/api\/rapid\/orders['"],\s*requirePublicRequestSlot,/);
  assert.match(server, /app\.post\(['"]\/api\/network\/client-telemetry['"],\s*requirePublicRequestSlot,/);
});
