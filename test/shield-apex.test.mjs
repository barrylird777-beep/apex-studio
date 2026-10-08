import assert from "node:assert/strict";
import test from "node:test";
import { createShieldApex } from "../src/core/shield-apex.mjs";

test("ShieldApex fails closed when no origin or API key is configured", () => {
  const shield=createShieldApex({clock:()=>0});
  assert.equal(shield.authorizeOrigin("https://example.com"),false);
  assert.equal(shield.authorizeApiKey("anything"),false);
  assert.equal(shield.status().configuredKeys,0);
});

test("ShieldApex authorizes only configured origins and API keys", () => {
  const shield=createShieldApex({
    allowedOrigins:["https://apexus.example"],
    apiKeys:["secret-key"],
    clock:()=>0
  });
  assert.equal(shield.authorizeOrigin("https://apexus.example"),true);
  assert.equal(shield.authorizeOrigin("https://evil.example"),false);
  assert.equal(shield.authorizeApiKey("secret-key"),true);
  assert.equal(shield.authorizeApiKey("wrong-key"),false);
});

test("ShieldApex capability authorization is least-privilege", () => {
  const shield=createShieldApex();
  assert.equal(shield.authorizeCapability(new Set(["broadcast.read"]),"broadcast.read"),true);
  assert.equal(shield.authorizeCapability(new Set(["broadcast.read"]),"broadcast.write"),false);
  assert.equal(shield.authorizeCapability(["worker.claim"]),"worker.claim"),true);
  assert.equal(shield.authorizeCapability(null,"worker.claim"),false);
});

test("ShieldApex audit records are bounded and do not expose credentials", () => {
  const shield=createShieldApex({apiKeys:["super-secret"],clock:()=>1700000000000});
  const record=shield.audit("authorized request");
  assert.match(record.id,/^[0-9a-f-]{36}$/);
  assert.equal(record.at,"2023-11-14T22:13:20.000Z");
  assert.equal(record.event,"authorized request");
  assert.doesNotMatch(JSON.stringify(record),/super-secret/);
});
