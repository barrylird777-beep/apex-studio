import test from "node:test";
import assert from "node:assert/strict";
import { verifyStripeWebhook } from "../edge/apex-billing-worker.mjs";

async function signature(raw, secret, timestamp) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(timestamp + "." + raw)));
  const hex = Array.from(digest, b => b.toString(16).padStart(2, "0")).join("");
  return "t=" + timestamp + ",v1=" + hex;
}

test("Stripe webhook verifier accepts a fresh authentic signature", async () => {
  const raw = '{"id":"evt_test","type":"checkout.session.completed"}';
  const header = await signature(raw, "whsec_test_secret", 1500);
  assert.equal(await verifyStripeWebhook(raw, header, "whsec_test_secret", 1500), true);
});

test("Stripe webhook verifier rejects tampering and stale signatures", async () => {
  const raw = '{"id":"evt_test","type":"checkout.session.completed"}';
  const header = await signature(raw, "whsec_test_secret", 1500);
  assert.equal(await verifyStripeWebhook(raw + " ", header, "whsec_test_secret", 1500), false);
  assert.equal(await verifyStripeWebhook(raw, header, "whsec_test_secret", 2000), false);
});
