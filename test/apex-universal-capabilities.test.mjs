import test from "node:test";
import assert from "node:assert/strict";
import {
  APEX_UNIVERSAL_CAPABILITIES,
  APEX_LOCAL_POLICY,
  buildUniversalExecutionEnvelope,
  normalizeApexCapability
} from "../src/core/apex-universal-capabilities.mjs";

test("universal Apex capability registry is complete", () => {
  assert.deepEqual(APEX_UNIVERSAL_CAPABILITIES, [
    "ai", "scripture", "visual", "audio", "video", "orchestration"
  ]);
});

test("local execution is the default policy", () => {
  assert.equal(APEX_LOCAL_POLICY.preferred, "local");
  assert.equal(APEX_LOCAL_POLICY.cloudRequired, false);
  assert.equal(APEX_LOCAL_POLICY.networkInferenceRequired, false);
  assert.equal(APEX_LOCAL_POLICY.providerQuotaBypass, false);
  assert.equal(APEX_LOCAL_POLICY.permanentIosDaemon, false);
});

test("execution envelopes normalize capabilities", () => {
  const envelope = buildUniversalExecutionEnvelope({
    capability: "VIDEO",
    request: "create a short",
    source: "trend"
  });
  assert.equal(envelope.capability, "video");
  assert.equal(envelope.execution.localPreferred, true);
  assert.equal(envelope.provenance.originalExpressionRequired, true);
  assert.equal(normalizeApexCapability("not-a-capability"), "ai");
});
