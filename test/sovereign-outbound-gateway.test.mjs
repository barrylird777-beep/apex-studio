import test from "node:test";
import assert from "node:assert/strict";
import {
  APEX_CANONICAL_APPS,
  OutboundPolicyError,
  createSovereignLlmGateway,
  sanitizeOutboundPayload,
  validateProviderTarget,
  validateOutboundTarget,
  createGuardedFetch,
  hashStagedChange,
  validateStagedChange
} from "../src/security/sovereign-outbound-gateway.mjs";

test("outbound payload screening blocks common credential formats", () => {
  for (const secret of [
    "sk_live_12345678901234567890",
    "ghp_123456789012345678901234",
    "AKIAABCDEFGHIJKLMNOP",
    "postgres://user:pass@example.invalid/db"
  ]) {
    assert.throws(
      () => sanitizeOutboundPayload({ messages: [{ role: "user", content: secret }] }),
      error => error instanceof OutboundPolicyError && error.code === "SECRET_DETECTED"
    );
  }
});

test("outbound payload screening catches bearer and base64-obfuscated credentials", () => {
  const cases = [
    "Authorization: Bearer ghp_123456789012345678901234",
    "xai-12345678901234567890123456789012",
    "hf_12345678901234567890123456789012",
    Buffer.from("ghp_123456789012345678901234", "utf8").toString("base64"),
    "g h p _ 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4",
    "ghp%5F123456789012345678901234"
  ];
  for (const value of cases) {
    assert.throws(
      () => sanitizeOutboundPayload({ prompt: value }),
      error => error instanceof OutboundPolicyError && error.code === "SECRET_DETECTED"
    );
  }
});

test("outbound payload screening blocks secret-bearing object keys", () => {
  assert.throws(
    () => sanitizeOutboundPayload({ api_key: "should-not-leave-process" }),
    error => error instanceof OutboundPolicyError && error.code === "SECRET_FIELD_DETECTED"
  );
});

test("identifiers are pseudonymized for one outbound request", () => {
  const clean = sanitizeOutboundPayload({ user_id: "user-123", messages: [{ role: "user", content: "hello" }] });
  assert.notEqual(clean.user_id, "user-123");
  assert.match(clean.user_id, /^session_[a-f0-9]{20}$/);
  assert.equal(clean.messages[0].content, "hello");
});

test("provider target validation requires the exact HTTPS host", () => {
  assert.equal(validateProviderTarget("openai", "https://api.openai.com/v1/chat/completions").target.hostname, "api.openai.com");
  assert.throws(() => validateProviderTarget("openai", "http://api.openai.com/v1/chat/completions"), /HTTPS allowlist/);
  assert.throws(() => validateProviderTarget("openai", "https://api.openai.com.attacker.invalid/v1/chat/completions"), /HTTPS allowlist/);
  assert.throws(() => validateProviderTarget("unknown", "https://example.invalid"), /Unknown provider/);
});

test("provider request sends only sanitized payload and falls back locally on provider outage", async () => {
  let sent;
  const gateway = createSovereignLlmGateway({
    env: { OPENAI_API_KEY: "test-only-key" },
    fetchImpl: async (url, options) => {
      assert.equal(new URL(url).hostname, "api.openai.com");
      sent = JSON.parse(options.body);
      return { status: 200, ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) };
    },
    localGenerate: async (_payload, meta) => ({ local: true, reason: meta?.fallbackReason })
  });
  const result = await gateway.chat({
    provider: "openai",
    payload: { user_id: "user-123", messages: [{ role: "user", content: "hello" }] }
  });
  assert.notEqual(sent.user_id, "user-123");
  assert.equal(result.trusted, false);

  const outage = createSovereignLlmGateway({
    env: { OPENAI_API_KEY: "test-only-key" },
    fetchImpl: async () => ({ status: 503, ok: false }),
    localGenerate: async (_payload, meta) => ({ local: true, reason: meta?.fallbackReason })
  });
  assert.deepEqual(await outage.chat({ provider: "openai", payload: { messages: [] } }), {
    local: true, reason: "provider_http_503"
  });
});

test("staged changes require an approved canonical app and matching digest", () => {
  assert.deepEqual(APEX_CANONICAL_APPS, [
    "PlanetApeX", "KoBlocks", "KernelVision", "KoinKob", "KashKorner", "Kernelodies"
  ]);
  const value = { action: "publish", version: 1 };
  const expectedDigest = hashStagedChange(value);
  assert.equal(validateStagedChange({ value, expectedDigest, approved: true, app: "PlanetApeX", allowedApps: APEX_CANONICAL_APPS }).app, "PlanetApeX");
  assert.throws(() => validateStagedChange({ value, expectedDigest, app: "PlanetApeX", allowedApps: APEX_CANONICAL_APPS }), /approval/);
  assert.throws(() => validateStagedChange({ value, expectedDigest: "sha256:wrong", approved: true, app: "PlanetApeX", allowedApps: APEX_CANONICAL_APPS }), /digest mismatch/);
});


test("central outbound guard rejects unapproved hosts, insecure URLs, and redirects", async () => {
  assert.equal(validateOutboundTarget("https://api.openai.com/v1/responses", ["api.openai.com"]).hostname, "api.openai.com");
  assert.throws(() => validateOutboundTarget("http://api.openai.com/v1/responses", ["api.openai.com"]), /HTTPS host allowlist/);
  assert.throws(() => validateOutboundTarget("https://api.openai.com.attacker.invalid/", ["api.openai.com"]), /HTTPS host allowlist/);
  const guarded = createGuardedFetch(["api.openai.com"], async (_url, options) => ({ options }));
  const result = await guarded("https://api.openai.com/v1/responses", { method: "POST" });
  assert.equal(result.options.redirect, "error");
  assert.throws(() => guarded("https://attacker.invalid/", {}), /HTTPS host allowlist/);
});
