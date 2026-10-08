import test from "node:test";
import assert from "node:assert/strict";

test("network settings are explained in plain English", async () => {
  const { describeNetworkSettings } = await import("../src/core/network-status.mjs");
  const s = describeNetworkSettings({ speed: "maximum" });
  assert.equal(s.speed, "Maximum speed");
  assert.equal(s.multipleConnections, "On");
  assert.equal(s.automaticFailover, "On");
  assert.match(s.explanation, /available network capacity/);
});


test("production network telemetry contract exposes the custom client header and avoids duplicate permissive CORS", async () => {
  const { readFile } = await import("node:fs/promises");
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /'X-Apex-Client-Id'/);
  assert.equal((server.match(/app\.use\(cors\(\)\)/g) || []).length, 0);
  assert.match(server, /Cache-Control', 'no-store'/);
});

test("network capability claims require explicit verification", async () => {
  const { readFile } = await import("node:fs/promises");
  const selector = await readFile(new URL("../src/network/path-selector.mjs", import.meta.url), "utf8");
  assert.match(selector, /APEX_VERIFIED_NETWORK_CAPABILITIES/);
  assert.match(selector, /sixGVerified: VERIFIED_NETWORK_CAPABILITIES\.has\('6g'\)/);
  assert.match(selector, /starlinkVerified: VERIFIED_NETWORK_CAPABILITIES\.has\('starlink'\)/);
});
