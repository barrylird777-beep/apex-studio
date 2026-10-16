import test from "node:test";
import assert from "node:assert/strict";
import billing from "../edge/apex-billing-worker.mjs";
import { verifyApexLicense } from "../public/apex-license-verify.js";

const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));

test("checkout uses the configured price, not a client-supplied amount", async () => {
  const originalFetch = globalThis.fetch;
  let form;
  globalThis.fetch = async (url, options) => {
    form = new URLSearchParams(options.body);
    return new Response(JSON.stringify({ id: "cs_test_created", url: "https://checkout.stripe.com/c/pay_test" }), { status: 200 });
  };
  try {
    const request = new Request("https://billing.example/checkout", {
      method: "POST", headers: { Origin: "https://app.example", "Content-Type": "application/json" },
      body: JSON.stringify({ appId: "kernel-vision", entitlement: "advanced-render", amount: 1 })
    });
    const response = await billing.fetch(request, { STRIPE_SECRET_KEY: "sk_test_secret", APEX_ALLOWED_ORIGINS: "https://app.example", PRICE_KERNELVISION_RENDER: "price_render" });
    assert.equal(response.status, 200);
    assert.equal(form.get("line_items[0][price]"), "price_render");
    assert.equal(form.get("line_items[0][quantity]"), "1");
    assert.equal(form.has("amount"), false);
  } finally { globalThis.fetch = originalFetch; }
});

test("paid Stripe session produces a locally verifiable app-bound token", async () => {
  const originalFetch = globalThis.fetch;
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKeyBase64 = b64(await crypto.subtle.exportKey("raw", pair.publicKey));
  const privateKeyBase64 = b64(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  globalThis.fetch = async url => {
    const value = String(url);
    if (value.endsWith("/checkout/sessions/cs_test_paid")) return new Response(JSON.stringify({
      id: "cs_test_paid", status: "complete", payment_status: "paid", mode: "payment",
      metadata: { appId: "kernel-vision", entitlement: "advanced-render" }
    }), { status: 200 });
    if (value.includes("/checkout/sessions/cs_test_paid/line_items")) return new Response(JSON.stringify({
      data: [{ price: { id: "price_render" }, quantity: 1 }]
    }), { status: 200 });
    throw new Error("Unexpected Stripe request: " + value);
  };
  try {
    const request = new Request("https://billing.example/license", {
      method: "POST", headers: { Origin: "https://app.example", "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "cs_test_paid" })
    });
    const response = await billing.fetch(request, {
      STRIPE_SECRET_KEY: "sk_test_secret", APEX_ALLOWED_ORIGINS: "https://app.example",
      PRICE_KERNELVISION_RENDER: "price_render", APEX_LICENSE_PRIVATE_KEY_PKCS8: privateKeyBase64
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    const claims = await verifyApexLicense({ token: result.token, publicKeyBase64, expectedAppId: "kernel-vision" });
    assert.equal(claims.checkoutSessionId, "cs_test_paid");
    assert.equal(claims.entitlement, "advanced-render");
  } finally { globalThis.fetch = originalFetch; }
});
