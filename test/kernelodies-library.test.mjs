import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createKernelodiesLibraryRouter } from "../src/api/kernelodies-library.mjs";

async function startApp(storageDir, options = {}) {
  const app = express();
  app.use(express.json());
  app.use("/api/kernelodies/library", createKernelodiesLibraryRouter({
    storageDir,
    getAvailableBytes: options.getAvailableBytes,
    authorize(req, res, next) {
      if (req.get("x-test-token") !== "test-secret") {
        return res.status(401).json({ ok: false, error: "Unauthorized" });
      }
      return next();
    }
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  };
}

test("Kernelodies library protects access and persists audio across app restarts", async () => {
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "kernelodies-library-test-"));
  let runtime;
  try {
    runtime = await startApp(storageDir);
    const denied = await fetch(runtime.base + "/api/kernelodies/library");
    assert.equal(denied.status, 401);

    const headers = { "x-test-token": "test-secret" };
    const createdResponse = await fetch(runtime.base + "/api/kernelodies/library", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ title: "Study Atmosphere", artist: "Jesus Freaks", album: "TheQuietDesk" })
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.equal(created.track.title, "Study Atmosphere");

    const audioBytes = Buffer.from("RIFF-test-audio-payload");
    const upload = await fetch(runtime.base + `/api/kernelodies/library/${created.track.id}/audio`, {
      method: "PUT",
      headers: { ...headers, "content-type": "audio/wav" },
      body: audioBytes
    });
    assert.equal(upload.status, 200);

    const beforeRestart = await fetch(runtime.base + "/api/kernelodies/library", { headers });
    const list = await beforeRestart.json();
    assert.equal(list.tracks.length, 1);
    assert.equal(list.tracks[0].checksum.length, 64);

    await runtime.close();
    runtime = await startApp(storageDir);
    const afterRestart = await fetch(runtime.base + "/api/kernelodies/library", { headers });
    const persisted = await afterRestart.json();
    assert.equal(persisted.tracks.length, 1);
    const playback = await fetch(runtime.base + persisted.tracks[0].audioUrl, { headers });
    assert.equal(playback.status, 200);
    assert.equal(playback.headers.get("content-type"), "audio/wav");
    assert.deepEqual(Buffer.from(await playback.arrayBuffer()), audioBytes);
  } finally {
    if (runtime) await runtime.close().catch(() => {});
    await fs.rm(storageDir, { recursive: true, force: true });
  }
});


test("Kernelodies metadata updates from separate app instances do not overwrite each other", async () => {
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "kernelodies-concurrency-test-"));
  let first;
  let second;
  try {
    first = await startApp(storageDir);
    second = await startApp(storageDir);
    const headers = { "x-test-token": "test-secret", "content-type": "application/json" };
    const writes = await Promise.all(Array.from({ length: 12 }, (_, index) => {
      const runtime = index % 2 ? first : second;
      return fetch(runtime.base + "/api/kernelodies/library", {
        method: "POST",
        headers,
        body: JSON.stringify({ title: "Concurrent Track " + index, artist: "Test Artist" })
      });
    }));
    assert.ok(writes.every(response => response.status === 201));
    const listing = await fetch(first.base + "/api/kernelodies/library", { headers: { "x-test-token": "test-secret" } });
    assert.equal(listing.status, 200);
    const data = await listing.json();
    assert.equal(data.tracks.length, 12);
    assert.equal(new Set(data.tracks.map(track => track.id)).size, 12);
  } finally {
    if (first) await first.close().catch(() => {});
    if (second) await second.close().catch(() => {});
    await fs.rm(storageDir, { recursive: true, force: true });
  }
});

test("Kernelodies library refuses a symlinked storage root", async () => {
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "kernelodies-symlink-test-"));
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "kernelodies-outside-test-"));
  let runtime;
  try {
    await fs.symlink(outsideDir, path.join(storageDir, "kernelodies-library"), "dir");
    runtime = await startApp(storageDir);
    const response = await fetch(runtime.base + "/api/kernelodies/library", {
      headers: { "x-test-token": "test-secret" }
    });
    assert.equal(response.status, 503);
    await assert.rejects(fs.access(path.join(outsideDir, "library.json")), { code: "ENOENT" });
  } finally {
    if (runtime) await runtime.close().catch(() => {});
    await fs.rm(storageDir, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
  }
});


test("Kernelodies protects shared-storage headroom before audio writes", async () => {
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "kernelodies-capacity-test-"));
  let runtime;
  try {
    runtime = await startApp(storageDir, { getAvailableBytes: async () => 1024 });
    const headers = { "x-test-token": "test-secret" };
    const preflight = await fetch(runtime.base + "/api/kernelodies/library/capacity?bytes=24", { headers });
    assert.equal(preflight.status, 507);
    const preflightBody = await preflight.json();
    assert.match(preflightBody.error, /shared storage is protected/i);

    const createdResponse = await fetch(runtime.base + "/api/kernelodies/library", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ title: "Capacity Test", artist: "Test Artist" })
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();

    const upload = await fetch(runtime.base + "/api/kernelodies/library/" + created.track.id + "/audio", {
      method: "PUT",
      headers: { ...headers, "content-type": "audio/wav" },
      body: Buffer.from("audio")
    });
    assert.equal(upload.status, 507);
    const library = await (await fetch(runtime.base + "/api/kernelodies/library", { headers })).json();
    assert.equal(library.tracks[0].audioUrl, null);
    const files = await fs.readdir(path.join(storageDir, "kernelodies-library"));
    assert.equal(files.some(name => name.endsWith(".wav")), false);
    assert.equal(files.some(name => name.includes(".tmp-")), false);
  } finally {
    if (runtime) await runtime.close().catch(() => {});
    await fs.rm(storageDir, { recursive: true, force: true });
  }
});
