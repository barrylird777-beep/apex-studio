import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
