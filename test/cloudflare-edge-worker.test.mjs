import test from "node:test";
import assert from "node:assert/strict";
import worker from "../cloudflare-http3-worker/src/index.js";

test("edge proxy strips Connection-nominated headers in both directions", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamRequest;
  globalThis.fetch = async (url, init) => {
    upstreamRequest = { url: String(url), headers: new Headers(init.headers) };
    return new Response("redirect", {
      status: 302,
      headers: {
        location: "/private/next?x=1",
        connection: "keep-alive, x-origin-private",
        "x-origin-private": "must-not-leak",
        "cache-control": "public, max-age=3600",
        server: "origin-detail"
      }
    });
  };

  try {
    const headers = new Headers({
      connection: "keep-alive, x-client-private",
      "x-client-private": "must-not-forward",
      "x-forwarded-host": "attacker.invalid",
      "x-forwarded-proto": "http",
      forwarded: "host=attacker.invalid"
    });
    const request = new Request("https://apex-free-http3-edge.tbtristan777.workers.dev/start", { headers });
    const response = await worker.fetch(request);

    assert.equal(upstreamRequest.url, "https://apex-studio-production.up.railway.app/start");
    assert.equal(upstreamRequest.headers.has("x-client-private"), false);
    assert.equal(upstreamRequest.headers.has("connection"), false);
    assert.equal(upstreamRequest.headers.has("x-forwarded-host"), false);
    assert.equal(upstreamRequest.headers.has("x-forwarded-proto"), false);
    assert.equal(upstreamRequest.headers.has("forwarded"), false);

    assert.equal(response.status, 302);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.has("connection"), false);
    assert.equal(response.headers.has("x-origin-private"), false);
    assert.equal(response.headers.has("server"), false);
    assert.equal(
      response.headers.get("location"),
      "https://apex-free-http3-edge.tbtristan777.workers.dev/private/next?x=1"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("edge proxy rejects CONNECT without contacting the origin", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response("unexpected"); };
  try {
    const request = { method: "CONNECT", url: "https://apex-free-http3-edge.tbtristan777.workers.dev:443", headers: new Headers() };
    const response = await worker.fetch(request);
    assert.equal(response.status, 405);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
