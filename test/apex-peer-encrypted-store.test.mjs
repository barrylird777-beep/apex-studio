import test from "node:test";
import assert from "node:assert/strict";
import { storeEncryptedObject, retrieveEncryptedObject } from "../public/apex-peer-encrypted-store.js";
import { sha256Hex } from "../public/apex-anchor-crypto.js";

function fakePeerWorker() {
  const records = new Map();
  return async message => {
    if (message.type === "STATUS") return { estimatedAvailableBytes: 8 * 1024 * 1024, peerStore: "indexeddb" };
    const key = message.namespace + ":" + message.hash;
    if (message.type === "PUT") {
      const data = new Uint8Array(message.bytes);
      if (await sha256Hex(data) !== message.hash) throw new Error("hash mismatch");
      records.set(key, data.slice());
      return { readbackVerified: true, durable: false };
    }
    if (message.type === "GET") {
      const data = records.get(key);
      if (!data) throw new Error("peer object not found");
      if (await sha256Hex(data) !== message.hash) throw new Error("hash mismatch");
      return { bytes: data.slice().buffer, byteLength: data.byteLength };
    }
    throw new Error("unsupported test command");
  };
}

test("encrypted IndexedDB adapter stores binary manifest and recovers verified bytes", async () => {
  const call = fakePeerWorker();
  const original = new Uint8Array(70001);
  for (let i = 0; i < original.length; i++) original[i] = (i * 19) % 251;
  const receipt = await storeEncryptedObject({ call, namespace: "KernelVision", secret: "mobile-test-secret-2026", data: original, chunkBytes: 16384 });
  assert.equal(receipt.writeVerified, true);
  assert.equal(receipt.durable, false);
  assert.equal(receipt.chunkCount, 5);
  const recovered = await retrieveEncryptedObject({ call, namespace: "KernelVision", secret: "mobile-test-secret-2026", manifestHash: receipt.manifestHash });
  assert.deepEqual(recovered.data, original);
  assert.equal(recovered.receipt.readbackVerified, true);
  assert.equal(recovered.receipt.durable, false);
});

test("encrypted adapter rejects writes when browser quota cannot be estimated", async () => {
  const call = async message => message.type === "STATUS" ? { estimatedAvailableBytes: null } : { readbackVerified: true };
  await assert.rejects(storeEncryptedObject({ call, namespace: "Kernelodies", secret: "mobile-test-secret-2026", data: new Uint8Array([1, 2, 3]) }), /quota estimate unavailable/);
});
