import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Transform, Readable } from "node:stream";
import { buildAdaptiveTransferController } from "../network/throughput-profile.mjs";
import { PeerStorageApiClient } from "./peer-storage-api-client.mjs";

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

async function readManifest() {
  try {
    return JSON.parse(await fs.readFile(PROJECT_FILE, "utf8"));
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

const peerAssetClient = () => new PeerStorageApiClient();
const MANIFEST_NAMESPACE = "assets";
const MANIFEST_KEY = "project-manifest";

async function updatePeerManifest(mutator) {
  const client = peerAssetClient();
  await client.init();
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await client.readRef(MANIFEST_NAMESPACE, MANIFEST_KEY);
    const manifest = current?.value?.manifest || { assets: [], exports: [], scenes: [] };
    const next = await mutator(structuredClone(manifest));
    try {
      await client.writeRef(MANIFEST_NAMESPACE, MANIFEST_KEY, { version: 1, manifest: next },
        { expectedHash: current?.hash ?? null });
      return next;
    } catch (error) {
      if (error.code !== "CAS_CONFLICT" || attempt === 7) throw error;
    }
  }
  throw new Error("peer manifest CAS retries exhausted");
}

export async function initStorage() {
  const client = peerAssetClient();
  await client.init();
}

export async function saveProjectAssetFromFile(type, sourcePath, extension) {
  const source = path.resolve(String(sourcePath || ""));
  const bytes = await fs.readFile(source);
  if (!bytes.length) throw new TypeError("Source artifact must be a non-empty regular file");
  return saveProjectAsset(type, bytes, extension);
}

export async function saveProjectAsset(type, buffer, extension) {
  const assetType = safePart(type, "type");
  const ext = safePart(String(extension ?? "").replace(/^\\./, ""), "extension").toLowerCase();
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (!bytes.length) throw new TypeError("Project asset cannot be empty");
  const client = peerAssetClient();
  await client.init();
  const stored = await client.putBlob(bytes);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const record = { type: assetType, url: "/api/peer-assets/" + stored.hash, hash: stored.hash,
    extension: ext, bytes: bytes.length, sha256, updatedAt: Date.now() };
  await updatePeerManifest(manifest => {
    manifest.assets = Array.isArray(manifest.assets) ? manifest.assets : [];
    manifest.exports = Array.isArray(manifest.exports) ? manifest.exports : [];
    manifest.exports = [record, ...manifest.exports.filter(entry => entry?.type !== assetType)];
    manifest.assets.push(record);
    return manifest;
  });
  return record;
}

export async function saveSceneAsset(sceneId, kind, buffer, extension, metadata = {}) {
  const sceneKey = safePart(sceneId, "sceneId");
  const assetKind = safePart(kind, "asset kind");
  if (!["image", "video", "audio"].includes(assetKind)) throw new TypeError("Unsupported scene asset kind");
  const ext = safePart(String(extension ?? "").replace(/^\\./, ""), "extension").toLowerCase();
  if (!["png", "jpg", "jpeg", "webp", "mp4", "wav", "mp3", "m4a", "aac"].includes(ext)) throw new TypeError("Unsupported scene asset extension");
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (!bytes.length) throw new TypeError("Scene asset cannot be empty");
  const client = peerAssetClient();
  await client.init();
  const stored = await client.putBlob(bytes);
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  const url = "/api/peer-assets/" + stored.hash;
  const updatedAt = Date.now();
  const record = { sceneId: sceneKey, [assetKind]: url, url, hash: stored.hash, bytes: bytes.length, sha256: digest, updatedAt };
  await updatePeerManifest(manifest => {
    manifest.assets = Array.isArray(manifest.assets) ? manifest.assets : [];
    manifest.exports = Array.isArray(manifest.exports) ? manifest.exports : [];
    manifest.scenes = Array.isArray(manifest.scenes) ? manifest.scenes : [];
    let scene = manifest.scenes.find(item => String(item?.id) === sceneKey);
    if (!scene) { scene = { id: sceneKey, durationMs: 4000, createdAt: updatedAt }; manifest.scenes.push(scene); }
    const durationMs = Number(metadata?.durationMs);
    if (Number.isFinite(durationMs) && durationMs >= 1000 && durationMs <= 600000) scene.durationMs = Math.max(Number(scene.durationMs) || 4000, Math.round(durationMs));
    scene[assetKind] = url;
    scene[assetKind + "Asset"] = { url, hash: stored.hash, bytes: bytes.length, sha256: digest, extension: ext, provenance: "peer-replicated" };
    scene.updatedAt = updatedAt;
    manifest.assets.push({ ...record, type: assetKind });
    return manifest;
  });
  return record;
}

export async function getProjectState() {
  const client = peerAssetClient();
  await client.init();
  const current = await client.readRef(MANIFEST_NAMESPACE, MANIFEST_KEY);
  return current?.value?.manifest || { assets: [], exports: [], scenes: [] };
}

export async function getPeerAsset(hash) {
  if (!/^[a-f0-9]{64}$/.test(String(hash || ""))) throw new TypeError("Invalid peer asset hash");
  const client = peerAssetClient();
  await client.init();
  return client.getBlob(hash);
}

export { STORAGE_DIR, PROJECT_FILE };

export async function downloadUrlAssetToStorage(url, episodeId, assetName, options = {}) {
  const { downloadHttpAsset } = await import('../network/http-range-transfer.mjs');
  const episode = safePart(episodeId, 'episodeId');
  const asset = safePart(assetName, 'assetName');
  await initStorage();
  const dir = path.join(STORAGE_DIR, 'episodes', episode);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const finalPath = path.join(dir, asset);
  const tempPath = finalPath + '.part-' + process.pid + '-' + Date.now();
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
  const dir = path.join(STORAGE_DIR, 'episodes', episode);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const finalPath = path.join(dir, asset);
  const tempPath = path.join(dir, '.' + asset + '.part-' + process.pid + '-' + Date.now());
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
