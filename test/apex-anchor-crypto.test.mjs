import test from "node:test";
import assert from "node:assert/strict";
import { encryptPeerObject, decryptPeerObject } from "../public/apex-anchor-crypto.js";

test("encrypted peer chunks round-trip and preserve integrity", async () => {
  const original = new Uint8Array(70001);
  for (let i = 0; i < original.length; i++) original[i] = (i * 31) % 251;
  const manifest = await encryptPeerObject({
    namespace: "kernel-vision",
    secret: "test-only-secret-2026",
    data: original,
    chunkBytes: 16384
  });
  assert.equal(manifest.chunks.length, 5);
  assert.ok(manifest.chunks.every(chunk => chunk.sha256.length === 64));
  assert.deepEqual(await decryptPeerObject({ manifest, secret: "test-only-secret-2026" }), original);
});

test("wrong secret and tampered ciphertext are rejected", async () => {
  const manifest = await encryptPeerObject({
    namespace: "kernelodies",
    secret: "correct-test-secret",
    data: new TextEncoder().encode("APEX peer integrity test"),
    chunkBytes: 16384
  });
  await assert.rejects(decryptPeerObject({ manifest, secret: "wrong-test-secret" }));
  const tampered = structuredClone(manifest);
  tampered.chunks[0].ciphertext[0] ^= 1;
  await assert.rejects(decryptPeerObject({ manifest: tampered, secret: "correct-test-secret" }), /integrity/);
});
