import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createKernelodiesDiscoveryRouter } from "../src/api/kernelodies-discovery.mjs";
import { ApexPureStore } from "../src/core/apex-pure-store.mjs";
import { ApexRingWAL } from "../src/core/apex-ring-wal.mjs";
import { createSovereignAppFabric } from "../src/core/sovereign-app-fabric.mjs";

function catalogResponse(entity = "song") {
  const results = entity === "album" ? [{
    collectionId: 456,
    collectionName: "Album B",
    artistName: "Artist B",
    primaryGenreName: "Metal",
    releaseDate: "2026-05-01T00:00:00Z",
    collectionViewUrl: "https://music.apple.com/us/album/album-b/456",
    artworkUrl100: "https://is1-ssl.mzstatic.com/image2.jpg"
  }] : [{
    trackId: 123,
    trackName: "Song A",
    artistName: "Artist A",
    collectionName: "Album A",
    primaryGenreName: "Rock",
    releaseDate: "2026-01-01T00:00:00Z",
    trackViewUrl: "https://music.apple.com/us/song-a/123",
    previewUrl: "https://audio-ssl.itunes.apple.com/preview.m4a",
    artworkUrl100: "https://is1-ssl.mzstatic.com/image.jpg",
    trackTimeMillis: 180000
  }];
  return new Response(JSON.stringify({ resultCount: results.length, results }), {
    status: 200,
    headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(JSON.stringify({ resultCount: results.length, results }))) }
  });
}

async function startApp({ fetchImpl } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kernelodies-discovery-test-"));
  const store = new ApexPureStore({
    root: path.join(dir, "projects"),
    wal: new ApexRingWAL({ file: path.join(dir, "wal", "ring.wal.jsonl") })
  });
  await store.init();
  const fabric = createSovereignAppFabric({ store });
  const app = express();
  app.use(express.json());
  app.use("/api/kernelodies/discovery", createKernelodiesDiscoveryRouter({
    fabric,
    fetchImpl,
    authorize(req, res, next) {
      if (req.get("x-test-token") !== "test-secret") return res.status(401).json({ success: false, error: "Unauthorized" });
      return next();
    }
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  return {
    base: "http://127.0.0.1:" + server.address().port,
    close: async () => {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await fs.rm(dir, { recursive: true, force: true });
    }
  };
}

test("Kernelodies discovery searches a public catalog and preserves source provenance", async () => {
  let requested;
  const runtime = await startApp({ fetchImpl: async url => {
    requested = new URL(url);
    return catalogResponse(requested.searchParams.get("entity"));
  }});
  try {
    const denied = await fetch(runtime.base + "/api/kernelodies/discovery/search?q=rock");
    assert.equal(denied.status, 401);

    const response = await fetch(runtime.base + "/api/kernelodies/discovery/search?q=ambient%20rock&entity=song", {
      headers: { "x-test-token": "test-secret" }
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(requested.hostname, "itunes.apple.com");
    assert.equal(data.source, "Apple iTunes Search API");
    assert.equal(data.results.length, 1);
    assert.equal(data.results[0].title, "Song A");
    assert.equal(data.results[0].durationSeconds, 180);
    assert.equal(data.results[0].previewUrl, "https://audio-ssl.itunes.apple.com/preview.m4a");

    const albums = await fetch(runtime.base + "/api/kernelodies/discovery/search?q=metal&entity=album", {
      headers: { "x-test-token": "test-secret" }
    });
    const albumData = await albums.json();
    assert.equal(albumData.results[0].title, "Album B");
    assert.equal(albumData.results[0].previewUrl, null);
  } finally {
    await runtime.close();
  }
});

test("Kernelodies saves discoveries and builds playlists in isolated Pure-WAL records", async () => {
  const runtime = await startApp({ fetchImpl: async url => catalogResponse(new URL(url).searchParams.get("entity")) });
  try {
    const headers = { "x-test-token": "test-secret", "content-type": "application/json" };
    const searched = await fetch(runtime.base + "/api/kernelodies/discovery/search?q=rock", { headers: { "x-test-token": "test-secret" } });
    const result = (await searched.json()).results[0];

    const savedResponse = await fetch(runtime.base + "/api/kernelodies/discovery/saved", {
      method: "POST", headers, body: JSON.stringify(result)
    });
    assert.equal(savedResponse.status, 201);
    const saved = (await savedResponse.json()).discovery;
    assert.equal(saved.recordType, "music-discovery");
    assert.ok(saved.discoveryId);

    const duplicateResponse = await fetch(runtime.base + "/api/kernelodies/discovery/saved", {
      method: "POST", headers, body: JSON.stringify(result)
    });
    assert.equal(duplicateResponse.status, 200);
    assert.equal((await duplicateResponse.json()).duplicate, true);

    const listing = await fetch(runtime.base + "/api/kernelodies/discovery/saved", { headers: { "x-test-token": "test-secret" } });
    assert.equal((await listing.json()).discoveries.length, 1);

    const playlistResponse = await fetch(runtime.base + "/api/kernelodies/discovery/playlists", {
      method: "POST", headers, body: JSON.stringify({ title: "Radar Mix", discoveryIds: [saved.discoveryId] })
    });
    assert.equal(playlistResponse.status, 201);
    const playlist = (await playlistResponse.json()).playlist;
    assert.equal(playlist.title, "Radar Mix");
    assert.equal(playlist.tracks.length, 1);

    const playlists = await fetch(runtime.base + "/api/kernelodies/discovery/playlists", { headers: { "x-test-token": "test-secret" } });
    assert.equal((await playlists.json()).playlists.length, 1);

    const invalid = await fetch(runtime.base + "/api/kernelodies/discovery/playlists", {
      method: "POST", headers, body: JSON.stringify({ title: "Bad Mix", discoveryIds: ["missing-id"] })
    });
    assert.equal(invalid.status, 400);
  } finally {
    await runtime.close();
  }
});

test("Kernelodies rejects unsafe catalog links and invalid search inputs", async () => {
  const runtime = await startApp({ fetchImpl: async () => catalogResponse("song") });
  try {
    const headers = { "x-test-token": "test-secret", "content-type": "application/json" };
    const invalidSearch = await fetch(runtime.base + "/api/kernelodies/discovery/search?q=x", { headers });
    assert.equal(invalidSearch.status, 400);

    const unsafe = await fetch(runtime.base + "/api/kernelodies/discovery/saved", {
      method: "POST",
      headers,
      body: JSON.stringify({
        sourceId: "99", entity: "song", title: "Bad", artist: "Artist",
        trackUrl: "https://evil.example/track", previewUrl: null, artworkUrl: null
      })
    });
    assert.equal(unsafe.status, 400);
  } finally {
    await runtime.close();
  }
});
