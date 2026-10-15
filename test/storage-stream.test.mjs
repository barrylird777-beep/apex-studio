import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { startTestPeerBridge } from "./helpers/test-peer-storage-bridge.mjs";

test("streamAssetToStorage writes without buffering and returns SHA-256", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "apex-stream-"));
  const socketPath = path.join(os.tmpdir(), "apex-stream-peer-" + crypto.randomUUID() + ".sock");
  const peer = await startTestPeerBridge(socketPath);
  const previous = {
    storage: process.env.STORAGE_DIR,
    app: process.env.APEX_APP_NAMESPACE,
    token: process.env.APEX_PEER_STORAGE_API_TOKEN_KERNELVISION,
    socket: process.env.APEX_PEER_STORAGE_API_SOCKET
  };
  Object.assign(process.env, {
    STORAGE_DIR: dir,
    APEX_APP_NAMESPACE: "KernelVision",
    APEX_PEER_STORAGE_API_TOKEN_KERNELVISION: peer.tokens.KernelVision,
    APEX_PEER_STORAGE_API_SOCKET: socketPath
  });
  try {
    const { streamAssetToStorage, getPeerAsset } = await import("../src/core/storage.mjs?stream-test=" + crypto.randomUUID());
    const data = Buffer.from("Apex streaming transfer test");
    const result = await streamAssetToStorage(Readable.from([data.subarray(0, 8), data.subarray(8)]), "episode-1", "asset.bin");
    assert.equal(result.bytes, data.length);
    assert.equal(result.path, null);
    assert.match(result.url, /^\\/api\\/peer-assets\\/[a-f0-9]{64}$/);
    assert.deepEqual(await getPeerAsset(result.hash), data);
    assert.equal(result.sha256, crypto.createHash("sha256").update(data).digest("hex"));
    assert.ok(result.transfer.parallelStreams >= 1);
    assert.equal(typeof result.averageMbps, "number");
  } finally {
    if (previous.storage === undefined) delete process.env.STORAGE_DIR; else process.env.STORAGE_DIR = previous.storage;
    if (previous.app === undefined) delete process.env.APEX_APP_NAMESPACE; else process.env.APEX_APP_NAMESPACE = previous.app;
    if (previous.token === undefined) delete process.env.APEX_PEER_STORAGE_API_TOKEN_KERNELVISION; else process.env.APEX_PEER_STORAGE_API_TOKEN_KERNELVISION = previous.token;
    if (previous.socket === undefined) delete process.env.APEX_PEER_STORAGE_API_SOCKET; else process.env.APEX_PEER_STORAGE_API_SOCKET = previous.socket;
    await peer.close();
    await rm(dir, { recursive: true, force: true });
  }
});
