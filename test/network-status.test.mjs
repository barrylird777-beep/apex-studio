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

test("network policy never claims multipath without multiple verified client paths", async () => {
  const { buildConnectionPolicy } = await import("../src/network/path-selector.mjs");

  const unverified = buildConnectionPolicy();
  assert.equal(unverified.mode, "single-path-multi-connection");
  assert.equal(unverified.maxLanes, 16);

  const oneVerifiedPath = buildConnectionPolicy({ clientVerifiedPaths: 1 });
  assert.equal(oneVerifiedPath.mode, "single-path-multi-connection");

  const verifiedMultipath = buildConnectionPolicy({ clientVerifiedPaths: 2 });
  assert.equal(verifiedMultipath.mode, "multipath-verified");
  assert.equal(verifiedMultipath.maxLanes, 16);
});
