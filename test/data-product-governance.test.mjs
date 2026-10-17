import test from "node:test";
import assert from "node:assert/strict";
import { DataProductRegistry, APEX_DATA_APPS } from "../src/core/data-product-governance.mjs";
import { createPrivacyPolicy, redact, validateDataProductManifest, evaluateDataProductAccess } from "../src/core/privacy.mjs";

function validProduct(overrides = {}) {
  return {
    id: "research-catalog-v1",
    app: "kernelvision",
    title: "Licensed Research Catalog",
    description: "A provenance-tracked, licensed dataset.",
    version: "1.0.0",
    classification: "public",
    sources: ["https://example.test/dataset"],
    schema: [{ name: "topic", type: "string", sensitivity: "ordinary" }],
    lineage: [{ source: "licensed-source-1", transform: "normalized", verified: true }],
    allowedPurposes: ["research", "commercial_license"],
    quality: { score: 0.92, checkedAt: "2026-10-16T12:00:00.000Z", limitations: [] },
    license: { model: "subscription", currency: "USD", price: 19, termsVersion: "2026-01" },
    ...overrides
  };
}

test("data products are limited to the six canonical app namespaces", () => {
  assert.deepEqual(APEX_DATA_APPS, ["planetapex", "xshield", "kernelvision", "koinkob", "kashkorner", "kernelodies"]);
  const registry = new DataProductRegistry();
  assert.throws(() => registry.register(validProduct({ app: "invented-seventh-app" }), { actor: "owner-1" }), /six canonical APEX apps/);
});

test("commercial publication requires verified lineage, quality, and explicit versioned terms", () => {
  const registry = new DataProductRegistry();
  registry.register(validProduct(), { actor: "owner-1" });
  assert.equal(registry.publish("research-catalog-v1", { actor: "owner-1" }).status, "published");

  const unverified = new DataProductRegistry();
  unverified.register(validProduct({ id: "unverified", lineage: [{ source: "source", transform: "unknown", verified: false }] }), { actor: "owner-1" });
  assert.throws(() => unverified.publish("unverified", { actor: "owner-1" }), error => error.code === "LINEAGE_UNVERIFIED");

  const noLicense = new DataProductRegistry();
  noLicense.register(validProduct({ id: "no-license", license: null }), { actor: "owner-1" });
  assert.throws(() => noLicense.publish("no-license", { actor: "owner-1" }), error => error.code === "LICENSE_REQUIRED");
});

test("data product grants enforce owner, namespace, purpose, expiration and revocation", () => {
  const registry = new DataProductRegistry();
  registry.register(validProduct(), { actor: "owner-1" });
  registry.publish("research-catalog-v1", { actor: "owner-1" });
  assert.throws(() => registry.grant({
    productId: "research-catalog-v1", subject: "customer-1", app: "kernelvision",
    purposes: ["research"]
  }, { actor: "attacker" }), error => error.code === "GRANT_OWNER_REQUIRED");

  assert.throws(() => registry.grant({
    productId: "research-catalog-v1", subject: "customer-1", app: "planetapex",
    purposes: ["research"]
  }, { actor: "owner-1" }), error => error.code === "APP_NAMESPACE_MISMATCH");

  const grant = registry.grant({
    productId: "research-catalog-v1", subject: "customer-1", app: "kernelvision",
    purposes: ["research"], expiresAt: "2099-01-01T00:00:00.000Z"
  }, { actor: "owner-1" });
  assert.equal(registry.authorize({
    productId: "research-catalog-v1", subject: "customer-1", app: "kernelvision",
    purpose: "research", grantId: grant.id
  }).allowed, true);
  assert.equal(registry.authorize({
    productId: "research-catalog-v1", subject: "customer-1", app: "kernelvision",
    purpose: "commercial_license", grantId: grant.id
  }).allowed, false);
  registry.revokeGrant(grant.id, { actor: "owner-1" });
  assert.equal(registry.authorize({
    productId: "research-catalog-v1", subject: "customer-1", app: "kernelvision",
    purpose: "research", grantId: grant.id
  }).allowed, false);
});

test("data product manifest requires provenance, license, retention and explicit personal-data status", () => {
  const manifest = {
    datasetId: "dataset-1",
    ownerTenantId: "tenant-1",
    appNamespace: "kernelvision",
    title: "Licensed set",
    source: "licensed-source",
    schemaVersion: "1",
    classification: "public",
    provenance: { sourceType: "licensed", collectedAt: "2026-10-01T00:00:00.000Z" },
    license: { id: "license-v1", commercialUse: true, redistribution: true },
    retention: { expiresAt: "2099-01-01T00:00:00.000Z" },
    personalData: false
  };
  assert.equal(validateDataProductManifest(manifest).valid, true);
  assert.equal(evaluateDataProductAccess(manifest, {
    tenantId: "tenant-1", appNamespace: "kernelvision", purpose: "commercial-sale"
  }).status, "allowed");
  assert.equal(evaluateDataProductAccess(manifest, {
    tenantId: "other-tenant", appNamespace: "kernelvision", purpose: "commercial-sale"
  }).reason, "tenant-isolation");
  assert.equal(evaluateDataProductAccess(manifest, {
    tenantId: "tenant-1", appNamespace: "kernelvision", purpose: "commercial-sale"
  }, new Date("2100-01-01T00:00:00.000Z")).reason, "retention-expired");
  assert.equal(validateDataProductManifest({ datasetId: "incomplete" }).valid, false);

  const personal = {
    ...manifest,
    datasetId: "personal-dataset",
    personalData: true,
    consent: { status: "granted", purpose: "customer-request" }
  };
  assert.equal(validateDataProductManifest(personal).valid, false,
    "granted consent must include a verifiable evidence reference");
  assert.equal(validateDataProductManifest({
    ...personal,
    consent: { status: "granted", purpose: "customer-request", evidenceRef: "consent-receipt-123" }
  }).valid, true);
  assert.equal(validateDataProductManifest({
    ...personal,
    consent: { status: "not-required", purpose: "legal-obligation" }
  }).valid, false, "consent exception must document its legal basis");
  assert.equal(validateDataProductManifest({
    ...personal,
    consent: { status: "not-required", purpose: "legal-obligation", legalBasis: "documented-review-123" }
  }).valid, true);
});

test("privacy defaults resist caller attempts to enable telemetry or remote processing", () => {
  const policy = createPrivacyPolicy({
    telemetry: true, remoteProviders: true, remoteSync: true,
    crashReporting: true, localOnly: false
  });
  assert.equal(policy.telemetry, false);
  assert.equal(policy.remoteSync, false);
  assert.equal(policy.crashReporting, false);
  assert.equal(policy.remoteProviders, process.env.APEX_ALLOW_REMOTE_PROVIDERS === "true");
  assert.equal(policy.localOnly, process.env.APEX_ALLOW_REMOTE_PROVIDERS !== "true");
});

test("redaction catches common secret fields without redacting ordinary token metadata", () => {
  const value = redact({
    apiKey: "secret-value",
    nested: { access_token: "abc", tokenAddress: "0x123", authorization: "Bearer abc.def.ghi" }
  });
  assert.equal(value.apiKey, "[REDACTED]");
  assert.equal(value.nested.access_token, "[REDACTED]");
  assert.equal(value.nested.tokenAddress, "0x123");
  assert.match(value.nested.authorization, /REDACTED/);
});

test("audit access is denied unless a trusted control-plane authorizer approves it", () => {
  const denied = new DataProductRegistry();
  denied.register(validProduct(), { actor: "owner-1" });
  assert.throws(() => denied.audit({ actor: "any-authenticated-user" }), error => error.code === "AUDIT_ACCESS_DENIED");

  const approved = new DataProductRegistry({ authorizeAudit: actor => actor === "security-auditor" });
  approved.register(validProduct(), { actor: "owner-1" });
  assert.throws(() => approved.audit({ actor: "owner-1" }), error => error.code === "AUDIT_ACCESS_DENIED");
  assert.equal(approved.audit({ actor: "security-auditor" }).length, 1);
});
