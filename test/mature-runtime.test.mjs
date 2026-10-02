import assert from "node:assert/strict";
import { MatureContentManager } from "../src/core/mature-content.mjs";
import { MatureRuntimeBoundary } from "../src/core/mature-runtime.mjs";

const mature = new MatureContentManager();
const runtime = new MatureRuntimeBoundary(mature);

assert.throws(() => runtime.open({ token: "missing" }), /Layers is locked/);

mature.updatePolicy({
  enabled: true,
  ageVerified: true,
  consentConfirmed: true,
  enabledCategories: ["mature-themes"],
  enabledMedia: { script: true }
});

const configured = new MatureContentManager({ passcode: "test-passcode" });
const token = configured.unlock("test-passcode").token;
const guarded = new MatureRuntimeBoundary(configured);
const session = guarded.open({ token, category: "mature-themes", mediaType: "script" });

assert.equal(session.state, "active");
assert.equal(guarded.list(token).length, 1);
assert.equal(guarded.close(session.id, token).state, "closed");

console.log("mature-runtime ok");
