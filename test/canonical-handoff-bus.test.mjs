import test from "node:test";
import assert from "node:assert/strict";
import { clearCanonicalHandoffs, publishCanonicalHandoff, listCanonicalHandoffs, canonicalHandoffStatus } from "../src/apps/canonical-handoff-bus.mjs";
import { canonicalTrajectory } from "../src/apps/canonical-trajectory.mjs";

test("canonical handoff bus accepts declared cross-app routes across the full six-app mesh", () => {
  clearCanonicalHandoffs();
  const event = publishCanonicalHandoff({
    from: "planet-apex",
    to: "ko-blocks",
    payload: { worldId: "world-1", regionCount: 2 }
  });
  assert.equal(event.contractVersion, "apex-canonical-handoff.v1");
  assert.equal(event.durable, false);
  assert.equal(listCanonicalHandoffs({ appId: "ko-blocks", limit: 1 })[0].id, event.id);
  const crossMesh = publishCanonicalHandoff({
    from: "planet-apex",
    to: "kash-korner",
    payload: { context: "validated-cross-app-handoff" }
  });
  assert.equal(crossMesh.to, "kash-korner");
  assert.throws(() => publishCanonicalHandoff({
    from: "unknown-app",
    to: "ko-blocks",
    payload: {}
  }), /Unknown Apex app/);
});

test("canonical handoff bus bounds payloads and reports its legacy in-memory durability honestly", () => {
  clearCanonicalHandoffs();
  assert.throws(() => publishCanonicalHandoff({
    from: "kernelodies",
    to: "ko-blocks",
    payload: { blob: "x".repeat(300000) }
  }), /size limit/);
  assert.equal(canonicalHandoffStatus().durable, false);
});

test("KernelVision and KashKorner exchange paid-order and verified-payment handoffs", () => {
  const edges = canonicalTrajectory().handoffs;
  assert.ok(edges.some(edge => edge.from === "kernel-vision" && edge.to === "kash-korner"));
  assert.ok(edges.some(edge => edge.from === "kash-korner" && edge.to === "kernel-vision"));
});
