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

test("mobile control plane accepts the documented control-token fallback", async () => {
  const express = (await import("express")).default;
  const { createMobileControlPlane } = await import("../src/api/mobile-control-plane.mjs");
  const previousShortcut = process.env.APEX_SHORTCUT_TOKEN;
  const previousControl = process.env.APEX_CONTROL_TOKEN;
  delete process.env.APEX_SHORTCUT_TOKEN;
  process.env.APEX_CONTROL_TOKEN = "test-control-token-123";

  const app = express();
  app.use("/api/mobile", createMobileControlPlane({
    getHealth: async () => ({ ok: true })
  }));
  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/mobile/status`, {
      headers: { "x-apex-shortcut-token": "test-control-token-123" }
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).success, true);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previousShortcut === undefined) delete process.env.APEX_SHORTCUT_TOKEN;
    else process.env.APEX_SHORTCUT_TOKEN = previousShortcut;
    if (previousControl === undefined) delete process.env.APEX_CONTROL_TOKEN;
    else process.env.APEX_CONTROL_TOKEN = previousControl;
  }
});

test("Railway liveness endpoint never waits on database health", async () => {
  const { readFile } = await import("node:fs/promises");
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const start = server.indexOf("app.get('/health'");
  const end = server.indexOf("app.get('/api/health'", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const liveness = server.slice(start, end);
  assert.match(liveness, /status: 'alive'/);
  assert.doesNotMatch(liveness, /buildHealthSnapshot|durableWorkerHealth/);
});
