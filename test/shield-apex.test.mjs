import test from "node:test";
import assert from "node:assert/strict";
import { createShieldApex } from "../src/core/shield-apex.mjs";

test("ShieldApex enforces configured API keys", () => {
  const shield = createShieldApex({ apiKeys: ["secret-key"] });
  assert.equal(shield.authorizeApiKey("secret-key"), true);
  assert.equal(shield.authorizeApiKey("wrong-key"), false);
});

test("ShieldApex enforces Studio origin and capability boundaries", () => {
  const shield = createShieldApex({ allowedOrigins: ["https://studio.example"] });
  assert.equal(shield.authorizeOrigin("https://studio.example"), true);
  assert.equal(shield.authorizeOrigin("https://evil.example"), false);
  assert.equal(shield.authorizeCapability(new Set(["production", "special-search"]), "production"), true);
  assert.equal(shield.authorizeCapability(new Set(["production"]), "network-root"), false);
});

test("ShieldApex produces auditable request identifiers", () => {
  const shield = createShieldApex({ clock: () => 0 });
  const audit = shield.audit("boundary-check");
  assert.equal(audit.event, "boundary-check");
  assert.equal(audit.at, "1970-01-01T00:00:00.000Z");
  assert.match(audit.id, /^[0-9a-f-]{36}$/);
});
