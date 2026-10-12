import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { sovereignAppFabric } from "../core/sovereign-app-fabric.mjs";

const APP_ID = "kernelodies";
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const AUDIO_TYPES = Object.freeze({
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a",
  "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/wav": "wav",
  "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/flac": "flac",
  "audio/webm": "webm"
});
const SAFE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

function inside(root, target) {
  const rel = path.relative(root, target);
  return rel !== "" && rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel);
}

export function createKernelodiesLibraryRouter({ storageDir, authorize = (_req, _res, next) => next(), records = sovereignAppFabric } = {}) {
  if (!storageDir) throw new TypeError("storageDir is required");
  if (!records || typeof records.list !== "function" || typeof records.get !== "function" || typeof records.put !== "function") {
    throw new TypeError("records must implement the sovereign app fabric record interface");
  }
  const router = express.Router();
  const storageBase = path.resolve(storageDir);
  const mediaRoot = path.join(storageBase, "kernelodies-media");

  async function ensureMediaRoot() {
    await fs.mkdir(storageBase, { recursive: true, mode: 0o700 });
    const baseInfo = await fs.lstat(storageBase);
    if (baseInfo.isSymbolicLink() || !baseInfo.isDirectory()) throw new Error("[SECURITY_VIOLATION] Configured media parent must be a real directory.");
    const realBase = await fs.realpath(storageBase);
    await fs.mkdir(mediaRoot, { recursive: true, mode: 0o700 });
    const mediaInfo = await fs.lstat(mediaRoot);
    if (mediaInfo.isSymbolicLink() || !mediaInfo.isDirectory()) throw new Error("[SECURITY_VIOLATION] Kernelodies media root must be a real directory.");
    const realMedia = await fs.realpath(mediaRoot);
    if (!inside(realBase, realMedia)) throw new Error("[SECURITY_VIOLATION] Kernelodies media path escaped configured storage.");
    return realMedia;
  }

  function safeId(value) {
    const id = String(value || "");
    if (!SAFE_ID.test(id)) throw Object.assign(new Error("Invalid track id"), { status: 400 });
    return id;
  }

  async function listTracks() {
    const rows = await records.list(APP_ID);
    return rows.map(row => clone(row.record)).filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async function getTrack(id) {
    const result = await records.get(APP_ID, id);
    return result?.record ? clone(result.record) : null;
  }

  router.use(authorize);

  router.get("/", async (_req, res) => {
    try {
      const tracks = await listTracks();
      return res.json({ ok: true, storage: "local-pure-wal", tracks });
    } catch (_error) {
      return res.status(503).json({ ok: false, error: "Kernelodies library unavailable" });
    }
  });

  router.post("/", express.json({ limit: "32kb" }), async (req, res) => {
    try {
      const title = String(req.body?.title || "").trim().slice(0, 200);
      if (!title) return res.status(400).json({ ok: false, error: "Track title is required" });
      const id = crypto.randomUUID();
      const record = {
        id, title,
        artist: String(req.body?.artist || "Unknown artist").trim().slice(0, 200),
        album: String(req.body?.album || "").trim().slice(0, 200),
        durationSeconds: Number.isFinite(Number(req.body?.durationSeconds)) && Number(req.body?.durationSeconds) >= 0 ? Number(req.body.durationSeconds) : null,
        mimeType: null, bytes: 0, checksum: null, audioUrl: null,
        createdAt: new Date().toISOString(), provenance: { source: "Kernelodies library import", originalBytesPreserved: true }
      };
      await records.put(APP_ID, id, record);
      return res.status(201).json({ ok: true, storage: "local-pure-wal", track: record });
    } catch (_error) {
      return res.status(503).json({ ok: false, error: "Could not save Kernelodies track metadata" });
    }
  });

  router.put("/:id/audio", express.raw({ type: () => true, limit: MAX_AUDIO_BYTES }), async (req, res) => {
    let id;
    try { id = safeId(req.params.id); }
    catch (error) { return res.status(400).json({ ok: false, error: error.message }); }
    const mimeType = String(req.get("content-type") || "").split(";")[0].toLowerCase();
    const extension = AUDIO_TYPES[mimeType];
    if (!extension) return res.status(415).json({ ok: false, error: "Unsupported audio type. Use MP3, M4A, AAC, WAV, OGG, FLAC, or WebM audio." });
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!bytes.length) return res.status(400).json({ ok: false, error: "Audio file is empty" });
    if (bytes.length > MAX_AUDIO_BYTES) return res.status(413).json({ ok: false, error: "Audio file exceeds 50 MB" });

    let finalPath;
    try {
      const track = await getTrack(id);
      if (!track) return res.status(404).json({ ok: false, error: "Track record not found" });
      const root = await ensureMediaRoot();
      const filename = id + "." + extension;
      finalPath = path.join(root, filename);
      const checksum = crypto.createHash("sha256").update(bytes).digest("hex");
      const tempPath = path.join(root, "." + filename + ".tmp-" + crypto.randomUUID());
      const handle = await fs.open(tempPath, "wx", 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); }
      finally { await handle.close(); }
      try { await fs.link(tempPath, finalPath); }
      finally { await fs.unlink(tempPath).catch(() => {}); }
      const dirHandle = await fs.open(root, "r");
      try { await dirHandle.sync(); } finally { await dirHandle.close(); }
      const updated = {
        ...track, mimeType, bytes: bytes.length, checksum,
        audioUrl: "/api/kernelodies/library/" + id + "/audio"
      };
      await records.put(APP_ID, id, updated);
      return res.json({ ok: true, storage: "local-pure-wal", track: updated });
    } catch (error) {
      if (error?.code === "EEXIST") return res.status(409).json({ ok: false, error: "Audio already exists for this track; it was not overwritten" });
      return res.status(503).json({ ok: false, error: "Could not persist Kernelodies audio safely" });
    }
  });

  router.get("/:id/audio", async (req, res) => {
    let id;
    try { id = safeId(req.params.id); }
    catch (error) { return res.status(400).json({ ok: false, error: error.message }); }
    try {
      const track = await getTrack(id);
      if (!track?.mimeType || !track.audioUrl) return res.status(404).json({ ok: false, error: "Audio is not available for this track" });
      const root = await ensureMediaRoot();
      const filename = path.join(root, id + "." + AUDIO_TYPES[track.mimeType]);
      const info = await fs.lstat(filename);
      if (info.isSymbolicLink() || !info.isFile()) throw new Error("[SECURITY_VIOLATION] Audio target is not a regular file.");
      const realFile = await fs.realpath(filename);
      if (!inside(root, realFile)) throw new Error("[SECURITY_VIOLATION] Audio path escaped media root.");
      const bytes = await fs.readFile(realFile);
      const checksum = crypto.createHash("sha256").update(bytes).digest("hex");
      if (bytes.length !== track.bytes || checksum !== track.checksum) {
        return res.status(503).json({ ok: false, error: "Audio integrity check failed; file preserved for inspection" });
      }
      res.set("Content-Type", track.mimeType);
      res.set("Content-Length", String(bytes.length));
      res.set("Cache-Control", "private, no-store");
      res.set("X-Content-Type-Options", "nosniff");
      return res.send(bytes);
    } catch (_error) {
      return res.status(404).json({ ok: false, error: "Audio file unavailable" });
    }
  });

  return router;
}
