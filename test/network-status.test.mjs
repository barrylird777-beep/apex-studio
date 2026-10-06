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
