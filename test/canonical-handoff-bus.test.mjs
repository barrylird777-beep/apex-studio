import test from "node:test";
import assert from "node:assert/strict";
import { clearCanonicalHandoffs, publishCanonicalHandoff, listCanonicalHandoffs, canonicalHandoffStatus } from "../src/apps/canonical-handoff-bus.mjs";
import { canonicalTrajectory } from "../src/apps/canonical-trajectory.mjs";

test("canonical handoff bus enforces trajectory routes", () => {
  clearCanonicalHandoffs();
  const event = publishCanonicalHandoff({
    from: "planet-apex",
    to: "xshield",
    payload: { worldId: "world-1", regionCount: 2 }
  });
  assert.equal(event.contractVersion, "apex-canonical-handoff.v1");
  assert.equal(event.durable, false);
  assert.equal(listCanonicalHandoffs({ appId: "xshield", limit: 1 })[0].id, event.id);
  assert.throws(() => publishCanonicalHandoff({
    from: "planet-apex",
    to: "kash-korner",
    payload: {}
  }), /Invalid canonical handoff/);
});

test("canonical handoff bus bounds payloads and reports non-durable state", () => {
  clearCanonicalHandoffs();
  assert.throws(() => publishCanonicalHandoff({
    from: "korn-knob",
    to: "xshield",
    payload: {}
  }), /Invalid canonical handoff/);
  assert.equal(canonicalHandoffStatus().durable, false);
});


test("KernelVision and KashKorner exchange paid-order and verified-payment handoffs", () => {
  const edges = canonicalTrajectory().handoffs;
  assert.ok(edges.some(edge => edge.from === "kernel-vision" && edge.to === "kash-korner"));
  assert.ok(edges.some(edge => edge.from === "kash-korner" && edge.to === "kernel-vision"));
});
