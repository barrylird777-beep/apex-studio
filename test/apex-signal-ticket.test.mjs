import test from "node:test";
import assert from "node:assert/strict";
import { verifyApexSignalTicket } from "../edge/apex-signal-worker.mjs";

const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));

async function ticket({ appId = "kernel-vision", issuedAt = 1000, expiresAt = 1600 } = {}) {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKeyBase64 = b64(await crypto.subtle.exportKey("raw", pair.publicKey));
  const claims = ["apex-signal-v1", appId, "room_test_123", "peer_test_123", String(issuedAt), String(expiresAt)].join("\n");
  const payload = b64url(new TextEncoder().encode(claims));
  const signature = b64url(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, new TextEncoder().encode("v1." + payload)));
  return { publicKeyBase64, value: "v1." + payload + "." + signature };
}

test("signaling tickets verify their app and room scope", async () => {
  const f = await ticket();
  const claims = await verifyApexSignalTicket(f.value, f.publicKeyBase64, 1200);
  assert.equal(claims.appId, "kernel-vision");
  assert.equal(claims.roomId, "room_test_123");
  await assert.rejects(verifyApexSignalTicket(f.value, f.publicKeyBase64, 1700), /expired/);
});

test("signaling ticket rejects modified signatures and unknown app IDs", async () => {
  const f = await ticket();
  const changed = f.value.slice(0, -1) + (f.value.endsWith("A") ? "B" : "A");
  await assert.rejects(verifyApexSignalTicket(changed, f.publicKeyBase64, 1200), /signature/);
  const invalidApp = await ticket({ appId: "legacy-app" });
  await assert.rejects(verifyApexSignalTicket(invalidApp.value, invalidApp.publicKeyBase64, 1200), /scope/);
});
