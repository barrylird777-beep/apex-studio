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


test("iPhone control-plane network policy keeps automatic failover enabled", async () => {
  const { buildConnectionPolicy } = await import("../src/network/path-selector.mjs");
  const policy = buildConnectionPolicy({ speed: "maximum", multipleConnections: true, failover: true, adaptive: true });
  assert.equal(policy.automaticFailover, true);
  assert.equal(policy.adaptiveSpeed, true);
  assert.equal(policy.artificialSpeedLimitMbps, null);
});
