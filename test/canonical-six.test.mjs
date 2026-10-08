import test from "node:test";
import assert from "node:assert/strict";
import { APEX_APPS, assertSixAppInvariant, listApexApps } from "../src/apps/apex-six-apps.mjs";
import { canonicalAppStatus, canonicalAppsStatus } from "../src/apps/canonical-six.mjs";

test("canonical six-app invariant", () => {
  assert.equal(assertSixAppInvariant(), true);
  assert.deepEqual(listApexApps().map(app => app.name), [
    "PlanetApeX",
    "KoBlocks",
    "KernelVision",
    "KoinKob",
    "KashKorner",
    "Kernelodies"
  ]);
  assert.equal(Object.keys(APEX_APPS).length, 6);
});

test("every canonical app exposes a live runtime status", () => {
  const rows = canonicalAppsStatus();
  assert.equal(rows.length, 6);
  for (const row of rows) {
    assert.equal(row.success, true);
    assert.equal(row.runtime.state, "ready");
    assert.ok(Array.isArray(row.capabilities));
  }
  assert.equal(canonicalAppStatus("kernel-vision").app.name, "KernelVision");
});
