import test from "node:test";
import assert from "node:assert/strict";
import { APEX_SYSTEMS, APEX_SURFACES, APEX_UNIVERSAL_CAPABILITIES, APEX_EXECUTION_POLICY, buildApexExecutionEnvelope, assertCanonicalBoundary } from "../src/core/apex-universe.mjs";

test("Apex has exactly three canonical systems", () => {
  assert.deepEqual(Object.keys(APEX_SYSTEMS), ["APEX_STUDIO","GARDEN_OF_APEX","KORNKNOB"]);
});

test("TeeVee and Special Search are Apex Studio surfaces", () => {
  assert.equal(APEX_SURFACES.TeeVee.owner, "apex-studio");
  assert.equal(APEX_SURFACES.SPECIAL_SEARCH.owner, "apex-studio");
  assert.doesNotThrow(() => assertCanonicalBoundary({system:"apex-studio",surface:"special-search"}));
  assert.throws(() => assertCanonicalBoundary({system:"garden-of-apex",surface:"special-search"}), /Special Search/);
});

test("all canonical systems can use the universal capability plane", () => {
  for (const item of Object.values(APEX_SYSTEMS)) {
    const envelope = buildApexExecutionEnvelope({ system: item.id });
    assert.equal(envelope.system, item.id);
    assert.equal(envelope.localPreferred, true);
    assert.equal(envelope.provenanceRequired, true);
    assert.deepEqual(envelope.capabilities, [...APEX_UNIVERSAL_CAPABILITIES]);
  }
});

test("TeeVee resolves to Apex Studio", () => {
  const envelope = buildApexExecutionEnvelope({surface:"teevee"});
  assert.equal(envelope.system, "apex-studio");
  assert.equal(envelope.surface, "teevee");
});

test("unsafe bypasses are never enabled while artificial execution ceilings remain forbidden", () => {
  assert.equal(APEX_EXECUTION_POLICY.providerQuotaBypass, false);
  assert.equal(APEX_EXECUTION_POLICY.billingBypass, false);
  assert.equal(APEX_EXECUTION_POLICY.accountAbuse, false);
  assert.equal(APEX_EXECUTION_POLICY.unrestrictedIosDaemon, false);
  assert.equal(APEX_EXECUTION_POLICY.artificialExecutionCeilings, false);
});
test("Studio-owned operational surfaces remain inside the three-system boundary", () => {
  const studio = APEX_SYSTEMS.APEX_STUDIO.id;
  assert.equal(APEX_SURFACES.TeeVee.owner, studio);
  assert.equal(APEX_SURFACES.SPECIAL_SEARCH.owner, studio);
  assertCanonicalBoundary({ system: studio, surface: "teevee" });
  assertCanonicalBoundary({ system: studio, surface: "special-search" });
});
