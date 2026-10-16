import test from "node:test";
import assert from "node:assert/strict";
import { verifyApexLicense } from "../public/apex-license-verify.js";

const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));

async function fixture({ appId = "kernel-vision", issuedAt = 1000, expiresAt = 2000 } = {}) {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKeyBase64 = b64(await crypto.subtle.exportKey("raw", pair.publicKey));
  const claims = ["apex-anchor-v1", appId, "advanced-render", String(issuedAt), String(expiresAt), "price_test", "cs_test_123"].join("\n");
  const payload = b64url(new TextEncoder().encode(claims));
  const signed = new TextEncoder().encode("v1." + payload);
  const signature = b64url(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, signed));
  return { publicKeyBase64, token: "v1." + payload + "." + signature };
}

test("valid license verifies and is bound to its app", async () => {
  const f = await fixture();
  const claims = await verifyApexLicense({ ...f, expectedAppId: "kernel-vision", nowSeconds: 1500 });
  assert.equal(claims.entitlement, "advanced-render");
  await assert.rejects(verifyApexLicense({ ...f, expectedAppId: "kernelodies", nowSeconds: 1500 }), /another app/);
});

test("expired and modified licenses are rejected", async () => {
  const expired = await fixture({ issuedAt: 1000, expiresAt: 1200 });
  await assert.rejects(verifyApexLicense({ ...expired, expectedAppId: "kernel-vision", nowSeconds: 1200 }), /expired/);
  const valid = await fixture();
  const modified = valid.token.slice(0, -1) + (valid.token.endsWith("A") ? "B" : "A");
  await assert.rejects(verifyApexLicense({ ...valid, token: modified, expectedAppId: "kernel-vision", nowSeconds: 1500 }), /signature/);
});
