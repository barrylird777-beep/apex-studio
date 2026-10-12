import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createKernelodiesLibraryRouter } from "../src/api/kernelodies-library.mjs";

async function startApp(storageDir) {
  const app = express();
  app.use(express.json());
  app.use("/api/kernelodies/library", createKernelodiesLibraryRouter({
    storageDir,
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
