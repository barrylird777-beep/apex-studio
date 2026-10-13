import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createWriteStream, constants as fsConstants } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Transform, Readable } from "node:stream";
import { buildAdaptiveTransferController } from "../network/throughput-profile.mjs";
import { resolveContainedPath, ensureContainedDirectory } from "./se-x-paths.mjs";

const isCI = process.env.CI === "true" || process.env.NODE_ENV === "test";
const STORAGE_DIR = path.resolve(
  isCI
    ? (process.env.APEX_TEST_STORAGE_DIR || path.join(os.tmpdir(), "apex-test-storage"))
    : (process.env.STORAGE_DIR || "/srv/apex/se-x/projects")
);
const PROJECT_FILE = path.join(STORAGE_DIR, "manifest.json");

let manifestQueue = Promise.resolve();

function safePart(value, label) {
  const part = String(value ?? "").trim();
  if (!part || part === "." || part === ".." || !/^[A-Za-z0-9._-]+$/.test(part)) {
    throw new TypeError(`Invalid ${label}`);
  }
  return part;
}

async function storagePath(relativePath, options = {}) {
  return resolveContainedPath(STORAGE_DIR, relativePath, { allowHidden: true, ...options });
}

async function writeContainedFile(relativePath, data, { exclusive = false, encoding = "utf8" } = {}) {
  const target = await storagePath(relativePath);
  const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT |
    (exclusive ? fsConstants.O_EXCL : fsConstants.O_TRUNC) | (fsConstants.O_NOFOLLOW || 0);
  const handle = await fs.open(target, flags, 0o600);
  try { await handle.writeFile(data, typeof data === "string" ? { encoding } : undefined); }
  finally { await handle.close(); }
}

async function readManifest() {
  try {
    const manifestPath = await storagePath("manifest.json", { mustExist: true });
    const handle = await fs.open(manifestPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
    try { return JSON.parse(await handle.readFile("utf8")); }
    finally { await handle.close(); }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return { assets: [], exports: [] };
  }
}

function queueManifestWrite(task) {
  const run = manifestQueue.then(task, task);
  manifestQueue = run.catch(() => {});
  return run;
}

export async function initStorage() {
  await fs.mkdir(STORAGE_DIR, { recursive: true, mode: 0o700 });
  const manifestPath = await storagePath("manifest.json");
  try {
    await fs.access(manifestPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await writeContainedFile("manifest.json", JSON.stringify({ assets: [], exports: [] }, null, 2), { exclusive: true }).catch((writeError) => {
      if (writeError?.code !== "EEXIST") throw writeError;
    });
  }
}

export async function saveProjectAsset(type, buffer, extension) {
  await initStorage();
  const assetType = safePart(type, "type");
  const ext = safePart(extension, "extension").replace(/^\./, "");
  const filename = `project_${assetType}.${ext}`;
  const filepath = await storagePath(filename);
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  await writeContainedFile(filename, bytes);

  return queueManifestWrite(async () => {
    const manifest = await readManifest();
    if (!Array.isArray(manifest.assets)) manifest.assets = [];
    if (!Array.isArray(manifest.exports)) manifest.exports = [];
    const record = {
      type: assetType,
      url: `/files/${encodeURIComponent(filename)}`,
      bytes: bytes.length,
      updatedAt: Date.now()
    };
    manifest.exports = [record, ...manifest.exports.filter(entry => entry?.type !== assetType)];
    const manifestPath = await storagePath("manifest.json");
    const temp = await storagePath(`manifest.json.tmp-${process.pid}-${Date.now()}`);
    await writeContainedFile(path.relative(STORAGE_DIR, temp), JSON.stringify(manifest, null, 2), { exclusive: true });
    await fs.rename(temp, manifestPath);
    return record;
  });
}

export async function saveSceneAsset(sceneId, kind, buffer, extension, metadata = {}) {
  await initStorage();
  const sceneKey = safePart(sceneId, "sceneId");
  const assetKind = safePart(kind, "asset kind");
  if (!["image", "video", "audio"].includes(assetKind)) throw new TypeError("Unsupported scene asset kind");
  const ext = safePart(String(extension ?? "").replace(/^\./, ""), "extension").toLowerCase();
  if (!["png", "jpg", "jpeg", "webp", "mp4", "wav", "mp3", "m4a", "aac"].includes(ext)) {
    throw new TypeError("Unsupported scene asset extension");
  }
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (!bytes.length) throw new TypeError("Scene asset cannot be empty");
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  const filename = `scene_${sceneKey}_${assetKind}_${crypto.randomUUID()}.${ext}`;
  const filepath = await storagePath(filename);
  const temp = await storagePath(filename + ".part-" + process.pid);
  await writeContainedFile(path.relative(STORAGE_DIR, temp), bytes, { exclusive: true });
  try {
    await fs.rename(temp, filepath);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
  const url = "/files/" + encodeURIComponent(filename);
  const updatedAt = Date.now();
  return queueManifestWrite(async () => {
    const manifest = await readManifest();
    if (!Array.isArray(manifest.assets)) manifest.assets = [];
    if (!Array.isArray(manifest.exports)) manifest.exports = [];
    if (!Array.isArray(manifest.scenes)) manifest.scenes = [];
    let scene = manifest.scenes.find(item => String(item?.id) === sceneKey);
    if (!scene) {
      scene = { id: sceneKey, durationMs: 4000, createdAt: updatedAt };
      manifest.scenes.push(scene);
    }
    const durationMs = Number(metadata?.durationMs);
    if (Number.isFinite(durationMs) && durationMs >= 1000 && durationMs <= 600000) {
      scene.durationMs = Math.max(Number(scene.durationMs) || 4000, Math.round(durationMs));
    }
    scene[assetKind] = url;
    scene[assetKind + "Asset"] = {
      url, bytes: bytes.length, sha256: digest, extension: ext, provenance: "unverified-imported-provider-output"
    };
    scene.updatedAt = updatedAt;
    manifest.assets.push({
      type: assetKind, sceneId: sceneKey, url, bytes: bytes.length, sha256: digest, updatedAt
    });
    const manifestPath = await storagePath("manifest.json");
    const tempManifest = await storagePath(`manifest.json.tmp-${process.pid}-${crypto.randomUUID()}`);
    await writeContainedFile(path.relative(STORAGE_DIR, tempManifest), JSON.stringify(manifest, null, 2), { exclusive: true });
    try {
      await fs.rename(tempManifest, manifestPath);
    } catch (error) {
      await fs.rm(tempManifest, { force: true }).catch(() => {});
      throw error;
    }
    return { sceneId: sceneKey, [assetKind]: url, url, bytes: bytes.length, sha256: digest, updatedAt };
  });
}

export async function getProjectState() {
  await initStorage();
  return readManifest();
}

export { STORAGE_DIR, PROJECT_FILE };


export async function downloadUrlAssetToStorage(url, episodeId, assetName, options = {}) {
  const { downloadHttpAsset } = await import('../network/http-range-transfer.mjs');
  const episode = safePart(episodeId, 'episodeId');
  const asset = safePart(assetName, 'assetName');
  await initStorage();
  const dir = await ensureContainedDirectory(STORAGE_DIR, `episodes/${episode}`);
  const finalPath = await storagePath(`episodes/${episode}/${asset}`);
  const tempPath = await storagePath(`episodes/${episode}/${asset}.part-${process.pid}-${Date.now()}`);
  try {
    const transferController = options.transferController || buildAdaptiveTransferController({ initial: Math.max(1, Number(options.parallelStreams) || 4) });
    const result = await downloadHttpAsset(url, tempPath, { ...options, transferController });
    await fs.rename(tempPath, finalPath);
    return Object.freeze({ ...result, episodeId: episode, assetName: asset, path: finalPath });
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    if (error?.code === 'SOURCE_NO_RANGE_SUPPORT' || error?.message === 'SOURCE_NO_RANGE_SUPPORT') {
      const response = await fetch(url);
      if (!response.ok || !response.body) throw new Error(`download returned HTTP ${response.status}`);
      return streamAssetToStorage(Readable.fromWeb(response.body), episode, asset, options);
    }
    throw error;
  }
}

export async function streamAssetToStorage(readableStream, episodeId, assetName, options = {}) {
  if (!readableStream || typeof readableStream.pipe !== 'function') throw new TypeError('readableStream must be a readable stream');
  const episode = safePart(episodeId, 'episodeId');
  const asset = safePart(assetName, 'assetName');
  const {
    transferController = buildAdaptiveTransferController(),
    onProgress = null,
    networkMetrics = null
  } = options || {};
  if (!transferController || typeof transferController.observe !== 'function') {
    throw new TypeError('transferController must expose observe()');
  }
  if (onProgress !== null && typeof onProgress !== 'function') {
    throw new TypeError('onProgress must be a function');
  }

  await initStorage();
  const dir = await ensureContainedDirectory(STORAGE_DIR, `episodes/${episode}`);
  const finalPath = await storagePath(`episodes/${episode}/${asset}`);
  const tempPath = await storagePath(`episodes/${episode}/.${asset}.part-${process.pid}-${Date.now()}`);
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  const startedAt = performance.now();
  let lastSampleAt = startedAt;
  let lastSampleBytes = 0;
  let peakMbps = 0;
  let latestControl = transferController.state;

  const digest = new Transform({
    transform(chunk, encoding, callback) {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
      bytes += data.length;
      const now = performance.now();
      if (now - lastSampleAt >= 250) {
        const elapsedSeconds = (now - lastSampleAt) / 1000;
        const mbps = ((bytes - lastSampleBytes) * 8) / elapsedSeconds / 1e6;
        peakMbps = Math.max(peakMbps, mbps);
        lastSampleAt = now;
        lastSampleBytes = bytes;
        const metrics = typeof networkMetrics === 'function'
          ? networkMetrics()
          : (networkMetrics || {});
        latestControl = transferController.observe({
          observedMbps: mbps,
          lossPct: metrics.lossPct || 0,
          rttMs: metrics.rttMs || 0
        });
        if (onProgress) {
          onProgress(Object.freeze({
            bytes,
            mbps,
            controller: latestControl
          }));
        }
      }
      hash.update(data);
      callback(null, data);
    }
  });

  try {
    await pipeline(readableStream, digest, createWriteStream(tempPath, { flags: 'wx', mode: 0o600 }));
    await fs.rename(tempPath, finalPath);
    const elapsedMs = Math.max(0.001, performance.now() - startedAt);
    const averageMbps = (bytes * 8) / (elapsedMs / 1000) / 1e6;
    peakMbps = Math.max(peakMbps, averageMbps);
    latestControl = transferController.observe({
      observedMbps: averageMbps,
      lossPct: typeof networkMetrics === 'function' ? (networkMetrics()?.lossPct || 0) : (networkMetrics?.lossPct || 0),
      rttMs: typeof networkMetrics === 'function' ? (networkMetrics()?.rttMs || 0) : (networkMetrics?.rttMs || 0)
    });
    return Object.freeze({
      episodeId: episode,
      assetName: asset,
      path: finalPath,
      bytes,
      sha256: hash.digest('hex'),
      elapsedMs,
      averageMbps,
      peakMbps,
      transfer: latestControl
    });
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}
