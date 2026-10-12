import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ApexPureStore } from "../src/core/apex-pure-store.mjs";
import { ApexRingWAL } from "../src/core/apex-ring-wal.mjs";
import { createSovereignAppFabric } from "../src/core/sovereign-app-fabric.mjs";
import { createKernelodiesLibraryRouter } from "../src/api/kernelodies-library.mjs";

function makeFabric(storageDir) {
  const store = new ApexPureStore({
    root: path.join(storageDir, "records"),
    wal: new ApexRingWAL({ file: path.join(storageDir, "wal", "ring.wal.jsonl") })
  });
  return createSovereignAppFabric({ store });
}

async function startApp(storageDir) {
  const app = express();
  const records = makeFabric(storageDir);
  app.use("/api/kernelodies/library", createKernelodiesLibraryRouter({
    storageDir,
    records,
    authorize(req, res, next) {
      if (req.get("x-test-token") !== "test-secret") return res.status(401).json({ ok: false, error: "Unauthorized" });
      return next();
    }
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  return {
    base: "http://127.0.0.1:" + server.address().port,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  };
}

const auth = { "x-test-token": "test-secret" };

test("Kernelodies library uses Pure-WAL records and preserves audio bytes across restart", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kernelodies-pure-wal-test-"));
  let app;
  try {
    app = await startApp(dir);
    assert.equal((await fetch(app.base + "/api/kernelodies/library")).status, 401);
    const createdResponse = await fetch(app.base + "/api/kernelodies/library", {
      method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ title: "Study Atmosphere", artist: "Jesus Freaks", album: "TheQuietDesk" })
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.equal(created.storage, "local-pure-wal");
    assert.equal(created.track.title, "Study Atmosphere");

    const bytes = Buffer.from("RIFF-original-audio-bytes");
    const upload = await fetch(app.base + "/api/kernelodies/library/" + created.track.id + "/audio", {
      method: "PUT", headers: { ...auth, "content-type": "audio/wav" }, body: bytes
    });
    assert.equal(upload.status, 200);
    const listBefore = await (await fetch(app.base + "/api/kernelodies/library", { headers: auth })).json();
    assert.equal(listBefore.tracks.length, 1);
    assert.equal(listBefore.tracks[0].checksum.length, 64);

    await app.close(); app = await startApp(dir);
    const listAfter = await (await fetch(app.base + "/api/kernelodies/library", { headers: auth })).json();
    assert.equal(listAfter.tracks.length, 1);
    const playback = await fetch(app.base + listAfter.tracks[0].audioUrl, { headers: auth });
    assert.equal(playback.status, 200);
    assert.equal(playback.headers.get("content-type"), "audio/wav");
    assert.deepEqual(Buffer.from(await playback.arrayBuffer()), bytes);
  } finally {
    if (app) await app.close().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("Kernelodies concurrent app instances retain every Pure-WAL record", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kernelodies-pure-wal-concurrency-"));
  let first, second;
  try {
    first = await startApp(dir); second = await startApp(dir);
    const responses = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      fetch((i % 2 ? first : second).base + "/api/kernelodies/library", {
        method: "POST", headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ title: "Concurrent " + i })
      })
    ));
    assert.ok(responses.every(response => response.status === 201));
    const data = await (await fetch(first.base + "/api/kernelodies/library", { headers: auth })).json();
    assert.equal(data.tracks.length, 10);
    assert.equal(new Set(data.tracks.map(track => track.id)).size, 10);
  } finally {
    if (first) await first.close().catch(() => {});
    if (second) await second.close().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("Kernelodies media refuses symlinked storage and does not write outside the volume", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kernelodies-pure-wal-symlink-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "kernelodies-outside-"));
  let app;
  try {
    app = await startApp(dir);
    const created = await fetch(app.base + "/api/kernelodies/library", {
      method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ title: "Do not escape storage" })
    });
    const track = (await created.json()).track;
    await fs.symlink(outside, path.join(dir, "kernelodies-media"), "dir");
    const upload = await fetch(app.base + "/api/kernelodies/library/" + track.id + "/audio", {
      method: "PUT", headers: { ...auth, "content-type": "audio/wav" }, body: Buffer.from("RIFF-test")
    });
    assert.equal(upload.status, 503);
    assert.deepEqual(await fs.readdir(outside), []);
  } finally {
    if (app) await app.close().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});
