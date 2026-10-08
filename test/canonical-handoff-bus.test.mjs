import test from "node:test";
import assert from "node:assert/strict";
import { clearCanonicalHandoffs, publishCanonicalHandoff, listCanonicalHandoffs, canonicalHandoffStatus } from "../src/apps/canonical-handoff-bus.mjs";

test("canonical handoff bus enforces trajectory routes", () => {
  clearCanonicalHandoffs();
  const event = publishCanonicalHandoff({
    from: "planet-apex",
    to: "ko-blocks",
    payload: { worldId: "world-1", regionCount: 2 }
  });
  assert.equal(event.contractVersion, "apex-canonical-handoff.v1");
  assert.equal(event.durable, false);
  assert.equal(listCanonicalHandoffs({ appId: "ko-blocks", limit: 1 })[0].id, event.id);
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
    to: "ko-blocks",
    payload: {}
  }), /Invalid canonical handoff/);
  assert.equal(canonicalHandoffStatus().durable, false);
});
