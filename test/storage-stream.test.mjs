import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("streamAssetToStorage writes without buffering and returns SHA-256", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "apex-stream-"));
  const previous = process.env.STORAGE_DIR;
  process.env.STORAGE_DIR = dir;
  try {
    const { streamAssetToStorage } = await import("../src/core/storage.mjs");
    const data = Buffer.from("Apex streaming transfer test");
    const result = await streamAssetToStorage(Readable.from([data.subarray(0, 8), data.subarray(8)]), "episode-1", "asset.bin");
    assert.equal(result.bytes, data.length);
    assert.equal((await readFile(result.path)).toString(), data.toString());
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
    assert.equal(result.transfer.parallelStreams, 4);
    assert.equal(typeof result.transfer.lastMbps, "number");
  } finally {
    if (previous === undefined) delete process.env.STORAGE_DIR;
    else process.env.STORAGE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
