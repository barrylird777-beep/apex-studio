import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const isCI = process.env.CI === "true" || process.env.NODE_ENV === "test";
const STORAGE_DIR = path.resolve(isCI ? path.join(os.tmpdir(), "apex-test-storage") : (process.env.STORAGE_DIR || "/srv/apex/se-x/projects"));
const PROJECT_FILE = path.join(STORAGE_DIR, "manifest.json");
const STORAGE_BACKEND = String(process.env.APEX_ASSET_STORAGE || "local").toLowerCase();
let manifestQueue = Promise.resolve();

function safePart(value, label) {
  const part = String(value ?? "").trim();
  if (!part || part === "." || part === ".." || !/^[A-Za-z0-9._-]+$/.test(part)) throw new TypeError(`Invalid ${label}`);
  return part;
}

function s3Config() {
  const endpoint = String(process.env.APEX_OBJECT_STORE_ENDPOINT || process.env.S3_ENDPOINT || "").replace(/\/$/, "");
  const bucket = String(process.env.APEX_OBJECT_STORE_BUCKET || process.env.S3_BUCKET || "").trim();
  const accessKey = String(process.env.AWS_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID || "");
  const secretKey = String(process.env.AWS_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY || "");
  if (!endpoint || !bucket || !accessKey || !secretKey) throw new Error("S3 storage requires S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY");
  return { endpoint, bucket, accessKey, secretKey, region: process.env.AWS_REGION || process.env.S3_REGION || "us-east-1" };
}
function hmac(key, value) { return crypto.createHmac("sha256", key).update(value).digest(); }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }

function signS3({ method, url, headers, accessKey, secretKey, region, service = "s3" }) {
  const parsed = new URL(url);
  const amzDate = headers["x-amz-date"];
  const date = amzDate.slice(0, 8);
  const canonicalHeaders = Object.entries(headers).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k.toLowerCase()}:${String(v).trim()}\n`).join("");
  const signedHeaders = Object.keys(headers).sort().map(k => k.toLowerCase()).join(";");
  const canonicalRequest = [method, parsed.pathname, "", canonicalHeaders, signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${secretKey}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const signingKey = hmac(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  return `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

async function putS3(key, body, contentType) {
  const cfg = s3Config();
  const url = `${cfg.endpoint}/${encodeURIComponent(cfg.bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const headers = {
    host: new URL(url).host,
    "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
    "x-amz-date": amzDate,
    "content-type": contentType || "application/octet-stream"
  };
  const response = await fetch(url, {
    method: "PUT",
    headers: { ...headers, authorization: signS3({ method: "PUT", url, headers, ...cfg }) },
    body,
    duplex: "half"
  });
  if (!response.ok) throw new Error(`S3 upload failed: HTTP ${response.status}`);
  const publicBase = String(process.env.S3_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return publicBase ? `${publicBase}/${key.split("/").map(encodeURIComponent).join("/")}` : `s3://${cfg.bucket}/${key}`;
}

async function readManifest() {
  try { return JSON.parse(await fs.readFile(PROJECT_FILE, "utf8")); }
  catch (error) { if (error?.code !== "ENOENT") throw error; return { assets: [], exports: [] }; }
}
function queueManifestWrite(task) {
  const run = manifestQueue.then(task, task);
  manifestQueue = run.catch(() => {});
  return run;
}
export async function initStorage() {
  if (STORAGE_BACKEND === "s3") return;
  await fs.mkdir(STORAGE_DIR, { recursive: true, mode: 0o700 });
  try { await fs.access(PROJECT_FILE); }
  catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await fs.writeFile(PROJECT_FILE, JSON.stringify({ assets: [], exports: [] }, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" })
      .catch(e => { if (e?.code !== "EEXIST") throw e; });
  }
}
export async function saveProjectAsset(type, buffer, extension) {
  const assetType = safePart(type, "type");
  const ext = safePart(extension, "extension").replace(/^\./, "");
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const filename = `project_${assetType}_${crypto.randomUUID()}.${ext}`;
  const contentType = String(process.env.APEX_ASSET_CONTENT_TYPE || "application/octet-stream");
  let url;
  if (STORAGE_BACKEND === "s3") {
    url = await putS3(`projects/${filename}`, bytes, contentType);
  } else {
    await initStorage();
    await fs.writeFile(path.join(STORAGE_DIR, filename), bytes, { mode: 0o600 });
    url = `/files/${encodeURIComponent(filename)}`;
  }
  return queueManifestWrite(async () => {
    await initStorage();
    const manifest = await readManifest();
    if (!Array.isArray(manifest.assets)) manifest.assets = [];
    if (!Array.isArray(manifest.exports)) manifest.exports = [];
    const record = { type: assetType, url, bytes: bytes.length, backend: STORAGE_BACKEND, updatedAt: Date.now() };
    manifest.exports = [record, ...manifest.exports.filter(entry => entry?.type !== assetType)];
    const temp = `${PROJECT_FILE}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(temp, JSON.stringify(manifest, null, 2), { encoding: "utf8", mode: 0o600 });
    await fs.rename(temp, PROJECT_FILE);
    return record;
  });
}
export async function getProjectState() { await initStorage(); return readManifest(); }
export { STORAGE_DIR, PROJECT_FILE, STORAGE_BACKEND };
