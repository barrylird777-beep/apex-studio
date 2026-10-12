import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";

const AUDIO_TYPES = Object.freeze({
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "audio/webm": "webm"
});
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const MIN_FREE_BYTES = 32 * 1024 * 1024;

export function createKernelodiesLibraryRouter({
  storageDir,
  authorize = (_req, _res, next) => next(),
  getAvailableBytes = async dir => {
    const stats = await fs.statfs(dir);
    return stats.bavail * stats.bsize;
  }
} = {}) {
  if (!storageDir) throw new TypeError("storageDir is required");
  const router = express.Router();
  const root = path.join(path.resolve(storageDir), "kernelodies-library");
  const manifestPath = path.join(root, "library.json");
  let writes = Promise.resolve();
  const lockPath = manifestPath + ".lock";

  async function syncDirectory(dir) {
    const handle = await fs.open(dir, "r");
    try { await handle.sync(); } finally { await handle.close(); }
  }

  async function acquireManifestLock() {
    const started = Date.now();
    while (true) {
      try {
        const handle = await fs.open(lockPath, "wx", 0o600);
        try {
          await handle.writeFile(JSON.stringify({ pid: process.pid, host: os.hostname(), createdAt: Date.now() }) + "\n", "utf8");
          await handle.sync();
        } catch (error) {
          await handle.close().catch(() => {});
          await fs.unlink(lockPath).catch(() => {});
          throw error;
        }
        await handle.close();
        return async () => {
          await fs.unlink(lockPath).catch(error => { if (error?.code !== "ENOENT") throw error; });
          await syncDirectory(root);
        };
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        let owner;
        try { owner = JSON.parse(await fs.readFile(lockPath, "utf8")); }
        catch (readError) { if (readError?.code === "ENOENT") continue; }
        let stale = false;
        if (owner?.host === os.hostname() && Number.isSafeInteger(owner.pid) && owner.pid > 0) {
          try { process.kill(owner.pid, 0); }
          catch (processError) { stale = processError?.code === "ESRCH"; }
        }
        // Never remove a lock just because it is old. If the owner is on another
        // host or cannot be proven dead, fail closed and let an operator inspect it.
        if (stale) {
          await fs.unlink(lockPath).catch(unlinkError => { if (unlinkError?.code !== "ENOENT") throw unlinkError; });
          continue;
        }
        if (Date.now() - started > 30_000) throw new Error("Timed out waiting for the Kernelodies library lock");
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
  }

  async function init() {
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    const rootInfo = await fs.lstat(root);
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error("Kernelodies storage root must be a real directory");
    try {
      const manifestInfo = await fs.lstat(manifestPath);
      if (manifestInfo.isSymbolicLink() || !manifestInfo.isFile()) throw new Error("Kernelodies manifest must be a regular file");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await fs.writeFile(manifestPath, JSON.stringify({ version: 1, tracks: [] }, null, 2), { flag: "wx", mode: 0o600 }).catch(e => { if (e?.code !== "EEXIST") throw e; });
      await syncDirectory(root);
    }
  }
  async function readManifest() {
    await init();
    const value = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    if (!Array.isArray(value.tracks)) throw new Error("Kernelodies library manifest is invalid");
    return value;
  }
  function updateManifest(fn) {
    const run = writes.then(async () => {
      await init();
      const release = await acquireManifestLock();
      let temp;
      try {
        const manifest = await readManifest();
        const result = await fn(manifest);
        temp = manifestPath + ".tmp-" + crypto.randomUUID();
        const handle = await fs.open(temp, "wx", 0o600);
        try {
          await handle.writeFile(JSON.stringify(manifest, null, 2) + "\n", "utf8");
          await handle.sync();
        } finally { await handle.close(); }
        await fs.rename(temp, manifestPath);
        temp = null;
        await syncDirectory(root);
        return result;
      } finally {
        if (temp) await fs.unlink(temp).catch(() => {});
        await release();
      }
    });
    writes = run.catch(() => {});
    return run;
  }
  function safeId(value) {
    const id = String(value || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error("Invalid track id");
    return id;
  }
  router.use(authorize);

  router.get("/", async (_req, res) => {
    try {
      const manifest = await readManifest();
      res.json({ ok: true, tracks: manifest.tracks.map(({ id, title, artist, album, durationSeconds, mimeType, bytes, checksum, createdAt, audioUrl }) => ({ id, title, artist, album, durationSeconds, mimeType, bytes, checksum, createdAt, audioUrl })) });
    } catch (error) { res.status(503).json({ ok: false, error: "Kernelodies library unavailable" }); }
  });

  router.get("/capacity", async (req, res) => {
    const requestedBytes = Number(req.query?.bytes ?? 0);
    if (!Number.isSafeInteger(requestedBytes) || requestedBytes < 0 || requestedBytes > MAX_AUDIO_BYTES) {
      return res.status(400).json({ ok: false, error: "Invalid requested audio size" });
    }
    try {
      await init();
      const availableBytes = Number(await getAvailableBytes(root));
      if (!Number.isFinite(availableBytes) || availableBytes < 0) throw new Error("Invalid free-space reading");
      const canUpload = availableBytes >= requestedBytes + MIN_FREE_BYTES;
      return res.status(canUpload ? 200 : 507).json({
        ok: canUpload,
        availableBytes,
        requestedBytes,
        reserveBytes: MIN_FREE_BYTES,
        ...(canUpload ? {} : { error: "Not enough free space; existing shared storage is protected." })
      });
    } catch (_error) {
      return res.status(503).json({ ok: false, error: "Unable to verify available storage space" });
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
        mimeType: null, bytes: 0, checksum: null, audioUrl: null, createdAt: new Date().toISOString()
      };
      await updateManifest(manifest => { manifest.tracks.unshift(record); return record; });
      res.status(201).json({ ok: true, track: record });
    } catch (_error) { res.status(400).json({ ok: false, error: "Could not create track record" }); }
  });

  router.put("/:id/audio", express.raw({ type: () => true, limit: MAX_AUDIO_BYTES }), async (req, res) => {
    let id;
    try { id = safeId(req.params.id); } catch (error) { return res.status(400).json({ ok: false, error: error.message }); }
    const mimeType = String(req.get("content-type") || "").split(";")[0].toLowerCase();
    const extension = AUDIO_TYPES[mimeType];
    if (!extension) return res.status(415).json({ ok: false, error: "Unsupported audio type. Use MP3, M4A, AAC, WAV, OGG, FLAC, or WebM audio." });
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!bytes.length) return res.status(400).json({ ok: false, error: "Audio file is empty" });
    if (bytes.length > MAX_AUDIO_BYTES) return res.status(413).json({ ok: false, error: "Audio file exceeds 50 MB" });
    try {
      await init();
      const record = (await readManifest()).tracks.find(track => track.id === id);
      if (!record) return res.status(404).json({ ok: false, error: "Track record not found" });
      let availableBytes;
      try { availableBytes = Number(await getAvailableBytes(root)); }
      catch (_error) { return res.status(503).json({ ok: false, error: "Unable to verify available storage space" }); }
      if (!Number.isFinite(availableBytes) || availableBytes < bytes.length + MIN_FREE_BYTES) {
        return res.status(507).json({ ok: false, error: "Not enough free space; existing shared storage is protected." });
      }
      const filename = id + "." + extension;
      const checksum = crypto.createHash("sha256").update(bytes).digest("hex");
      const finalPath = path.join(root, filename);
      const tempPath = path.join(root, "." + filename + ".tmp-" + crypto.randomUUID());
      try {
        const handle = await fs.open(tempPath, "wx", 0o600);
        try {
          await handle.writeFile(bytes);
          await handle.sync();
        } finally { await handle.close(); }
        await fs.link(tempPath, finalPath);
        await syncDirectory(root);
      } finally {
        await fs.unlink(tempPath).catch(() => {});
      }
      await updateManifest(manifest => {
        const track = manifest.tracks.find(item => item.id === id);
        if (!track) throw new Error("Track record disappeared");
        track.mimeType = mimeType; track.bytes = bytes.length; track.checksum = checksum; track.audioUrl = "/api/kernelodies/library/" + id + "/audio";
        return track;
      });
      res.json({ ok: true, track: { ...record, mimeType, bytes: bytes.length, checksum, audioUrl: "/api/kernelodies/library/" + id + "/audio" } });
    } catch (error) {
      if (error?.code === "EEXIST") return res.status(409).json({ ok: false, error: "Audio already exists for this track; it was not overwritten" });
      if (error?.code === "ENOSPC") return res.status(507).json({ ok: false, error: "Storage filled before the audio could be saved; no existing file was overwritten" });
      res.status(500).json({ ok: false, error: "Could not persist audio file" });
    }
  });

  router.get("/:id/audio", async (req, res) => {
    let id;
    try { id = safeId(req.params.id); } catch (error) { return res.status(400).json({ ok: false, error: "Invalid track id" }); }
    try {
      const track = (await readManifest()).tracks.find(item => item.id === id);
      if (!track?.mimeType || !track.audioUrl) return res.status(404).json({ ok: false, error: "Audio is not available for this track" });
      const extension = AUDIO_TYPES[track.mimeType];
      const filename = path.join(root, id + "." + extension);
      await fs.access(filename);
      res.set("Content-Type", track.mimeType);
      res.set("Content-Length", String(track.bytes));
      res.set("Cache-Control", "private, no-store");
      res.set("X-Content-Type-Options", "nosniff");
      return res.sendFile(filename);
    } catch (_error) { return res.status(404).json({ ok: false, error: "Audio file not found" }); }
  });

  return router;
}
