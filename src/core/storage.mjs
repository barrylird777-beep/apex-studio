import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

const isCI = process.env.CI === "true" || process.env.NODE_ENV === "test";
const STORAGE_DIR = path.resolve(
  isCI
    ? path.join(os.tmpdir(), "apex-test-storage")
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

export async function initStorage() {
  await fs.mkdir(STORAGE_DIR, { recursive: true, mode: 0o700 });
  try {
    await fs.access(PROJECT_FILE);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await fs.writeFile(PROJECT_FILE, JSON.stringify({ assets: [], exports: [] }, null, 2), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    }).catch((writeError) => {
      if (writeError?.code !== "EEXIST") throw writeError;
    });
  }
}

export async function saveProjectAsset(type, buffer, extension) {
  await initStorage();
  const assetType = safePart(type, "type");
  const ext = safePart(extension, "extension").replace(/^\./, "");
  const filename = `project_${assetType}.${ext}`;
  const filepath = path.join(STORAGE_DIR, filename);
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  await fs.writeFile(filepath, bytes, { mode: 0o600 });

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
    const temp = `${PROJECT_FILE}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(temp, JSON.stringify(manifest, null, 2), {
      encoding: "utf8", mode: 0o600
    });
    await fs.rename(temp, PROJECT_FILE);
    return record;
  });
}

export async function getProjectState() {
  await initStorage();
  return readManifest();
}

export { STORAGE_DIR, PROJECT_FILE };


export async function streamAssetToStorage(readableStream, episodeId, assetName) {
  if (!readableStream || typeof readableStream.pipe !== 'function') throw new TypeError('readableStream must be a readable stream');
  const episode = safePart(episodeId, 'episodeId');
  const asset = safePart(assetName, 'assetName');
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
  const digest = new (await import('node:stream')).Transform({
    transform(chunk, encoding, callback) {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
      bytes += data.length;
      const now = performance.now();
      if (now - lastSampleAt >= 250) {
        const mbps = ((bytes - lastSampleBytes) * 8) / ((now - lastSampleAt) / 1000) / 1e6;
        peakMbps = Math.max(peakMbps, mbps);
        lastSampleAt = now;
        lastSampleBytes = bytes;
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
    return Object.freeze({ episodeId: episode, assetName: asset, path: finalPath, bytes, sha256: hash.digest('hex'), elapsedMs, averageMbps, peakMbps });
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}
