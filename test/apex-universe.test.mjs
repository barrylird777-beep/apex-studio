import test from "node:test";
import assert from "node:assert/strict";
import {
  APEX_SURFACES,
  APEX_UNIVERSAL_CAPABILITIES,
  APEX_EXECUTION_POLICY,
  buildApexExecutionEnvelope
} from "../src/core/apex-universe.mjs";

test("Apex has six locked product surfaces", () => {
  assert.deepEqual(Object.keys(APEX_SURFACES), [
    "KORNKNOB",
    "APEX_STUDIOS",
    "GARDEN_OF_APEX",
    "APEX_OPPORTUNITY",
    "APEX_RAPID_VIDEO",
    "APEX_AD_BLOCKER"
  ]);
});

test("all six surfaces share the universal capability plane", () => {
  for (const item of Object.values(APEX_SURFACES)) {
    const envelope = buildApexExecutionEnvelope({ surface: item.id });
    assert.equal(envelope.localPreferred, true);
    assert.equal(envelope.provenanceRequired, true);
    assert.deepEqual(envelope.capabilities, [...APEX_UNIVERSAL_CAPABILITIES]);
  }
});

test("unsafe free-capacity bypasses are never enabled by policy", () => {
  assert.equal(APEX_EXECUTION_POLICY.providerQuotaBypass, false);
  assert.equal(APEX_EXECUTION_POLICY.billingBypass, false);
  assert.equal(APEX_EXECUTION_POLICY.accountAbuse, false);
  assert.equal(APEX_EXECUTION_POLICY.unrestrictedIosDaemon, false);
});
