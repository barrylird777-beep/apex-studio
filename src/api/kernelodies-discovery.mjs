import express from "express";
import { randomUUID } from "node:crypto";
import { discoverMusic } from "../core/music/music-discovery.mjs";
import { sovereignAppFabric } from "../core/sovereign-app-fabric.mjs";

function cleanText(value, max = 200) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function trustedHttpsUrl(raw, allowedHosts, optional = false) {
  if (optional && !raw) return null;
  try {
    const url = new URL(String(raw || ""));
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("URL must use HTTPS.");
    const host = url.hostname.toLowerCase();
    if (!allowedHosts.some(allowed => host === allowed || host.endsWith("." + allowed))) {
      throw new Error("URL host is not an approved music catalog host.");
    }
    return url.href;
  } catch (error) {
    throw new Error(error?.message === "URL host is not an approved music catalog host." ? error.message : "Invalid music catalog URL.");
  }
}

function normalizeDiscovery(input = {}) {
  const entity = String(input.entity || "");
  if (!["song", "album"].includes(entity)) throw new Error("Discovery entity must be song or album.");
  const sourceId = String(input.sourceId || "");
  if (!/^\d+$/.test(sourceId)) throw new Error("Discovery source ID is invalid.");
  const title = cleanText(input.title, 200);
  const artist = cleanText(input.artist, 160);
  if (!title || !artist) throw new Error("Discovery title and artist are required.");

  return {
    source: "Apple iTunes Search API",
    sourceId,
    entity,
    title,
    artist,
    album: cleanText(input.album, 200),
    genre: cleanText(input.genre, 100),
    releaseDate: cleanText(input.releaseDate, 40),
    durationSeconds: Number.isFinite(Number(input.durationSeconds)) && Number(input.durationSeconds) > 0
      ? Math.min(86400, Math.round(Number(input.durationSeconds)))
      : null,
    trackUrl: trustedHttpsUrl(input.trackUrl, ["music.apple.com", "itunes.apple.com"]),
    previewUrl: trustedHttpsUrl(input.previewUrl, ["audio-ssl.itunes.apple.com", "audio.itunes.apple.com"], true),
    artworkUrl: trustedHttpsUrl(input.artworkUrl, ["mzstatic.com"], true)
  };
}

function asRecord(row) {
  return row?.record && typeof row.record === "object" ? row.record : row;
}

export function createKernelodiesDiscoveryRouter({
  fabric = sovereignAppFabric,
  fetchImpl = globalThis.fetch,
  authorize = (_req, _res, next) => next()
} = {}) {
  const router = express.Router();
  router.use(authorize);

  async function listRecords() {
    return (await fabric.list("kernelodies")).map(asRecord).filter(record => record && typeof record === "object");
  }

  router.get("/search", async (req, res) => {
    try {
      const result = await discoverMusic(req.query.q, {
        entity: req.query.entity,
        limit: req.query.limit,
        fetchImpl
      });
      return res.json(result);
    } catch (error) {
      const invalid = error instanceof RangeError;
      return res.status(invalid ? 400 : 502).json({
        success: false,
        error: String(error?.message || error).slice(0, 220)
      });
    }
  });

  router.get("/saved", async (_req, res) => {
    try {
      const discoveries = (await listRecords())
        .filter(record => record.recordType === "music-discovery")
        .sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")));
      return res.json({ success: true, discoveries });
    } catch {
      return res.status(503).json({ success: false, error: "Kernelodies discovery storage is unavailable." });
    }
  });

  router.post("/saved", express.json({ limit: "16kb" }), async (req, res) => {
    try {
      const normalized = normalizeDiscovery(req.body || {});
      const existing = (await listRecords()).find(record =>
        record.recordType === "music-discovery" &&
        record.sourceId === normalized.sourceId &&
        record.entity === normalized.entity
      );
      if (existing) return res.json({ success: true, duplicate: true, discovery: existing });

      const discoveryId = randomUUID();
      const discovery = {
        ...normalized,
        discoveryId,
        recordType: "music-discovery",
        savedAt: new Date().toISOString(),
        provenance: { source: normalized.source, sourceId: normalized.sourceId, observedAt: String(req.body?.observedAt || "") }
      };
      await fabric.put("kernelodies", discoveryId, discovery);
      return res.status(201).json({ success: true, duplicate: false, discovery });
    } catch (error) {
      return res.status(400).json({ success: false, error: String(error?.message || error).slice(0, 220) });
    }
  });

  router.get("/playlists", async (_req, res) => {
    try {
      const records = await listRecords();
      const discoveries = new Map(records.filter(record => record.recordType === "music-discovery").map(record => [record.discoveryId, record]));
      const playlists = records.filter(record => record.recordType === "music-playlist")
        .map(record => ({ ...record, tracks: (record.discoveryIds || []).map(id => discoveries.get(id)).filter(Boolean) }))
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
      return res.json({ success: true, playlists });
    } catch {
      return res.status(503).json({ success: false, error: "Kernelodies playlist storage is unavailable." });
    }
  });

  router.post("/playlists", express.json({ limit: "24kb" }), async (req, res) => {
    try {
      const title = cleanText(req.body?.title, 100);
      const discoveryIds = [...new Set(Array.isArray(req.body?.discoveryIds) ? req.body.discoveryIds.map(value => String(value)) : [])];
      if (!title) return res.status(400).json({ success: false, error: "Playlist title is required." });
      if (!discoveryIds.length || discoveryIds.length > 100) {
        return res.status(400).json({ success: false, error: "Choose between 1 and 100 saved discoveries." });
      }

      const records = await listRecords();
      const discoveries = new Map(records.filter(record => record.recordType === "music-discovery").map(record => [record.discoveryId, record]));
      const missing = discoveryIds.filter(id => !discoveries.has(id));
      if (missing.length) return res.status(400).json({ success: false, error: "Playlist contains unsaved or unknown discoveries." });

      const playlistId = randomUUID();
      const playlist = {
        playlistId,
        recordType: "music-playlist",
        title,
        discoveryIds,
        createdAt: new Date().toISOString(),
        provenance: { source: "Kernelodies Pure-WAL discovery library" }
      };
      await fabric.put("kernelodies", playlistId, playlist);
      return res.status(201).json({ success: true, playlist: { ...playlist, tracks: discoveryIds.map(id => discoveries.get(id)) } });
    } catch (error) {
      return res.status(400).json({ success: false, error: String(error?.message || error).slice(0, 220) });
    }
  });

  return router;
}
