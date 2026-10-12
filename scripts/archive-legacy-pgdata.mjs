import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

const exec = promisify(execFile);
const volumeRoot = "/data";
const target = path.join(volumeRoot, "pgdata");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function hashFile(file) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: hash.digest("hex"), bytes };
}

async function treeFingerprint(root) {
  const stack = [root];
  const records = [];
  let totalBytes = 0;
  while (stack.length) {
    const current = stack.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const file = path.join(current, entry.name);
      const info = await fs.lstat(file);
      const relative = path.relative(root, file).split(path.sep).join("/");
      const type = info.isSymbolicLink() ? "link" : info.isDirectory() ? "dir" : info.isFile() ? "file" : "other";
      const linkTarget = info.isSymbolicLink() ? await fs.readlink(file) : "";
      records.push([relative, type, Number(info.mode), Number(info.size), Math.trunc(info.mtimeMs), linkTarget].join("\t"));
      if (info.isFile()) totalBytes += Number(info.size || 0);
      if (info.isDirectory() && !info.isSymbolicLink()) stack.push(file);
    }
  }
  records.sort();
  return { entries: records.length, bytes: totalBytes, sha256: sha256(Buffer.from(records.join("\n"), "utf8")) };
}

async function activePostgresProcesses() {
  const active = [];
  let pids;
  try { pids = await fs.readdir("/proc"); }
  catch (error) { throw new Error("Cannot verify PostgreSQL process state: " + (error.code || error.message)); }
  for (const pid of pids) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const name = (await fs.readFile(path.join("/proc", pid, "comm"), "utf8")).trim();
      if (/^(postgres|postmaster)$/i.test(name)) active.push({ pid: Number(pid), name });
    } catch {}
  }
  return active;
}

function objectStorageClient() {
  const endpoint = String(process.env.APEX_OBJECT_STORAGE_ENDPOINT || "").trim();
  const bucket = String(process.env.APEX_OBJECT_STORAGE_BUCKET || "").trim();
  const accessKeyId = String(process.env.APEX_OBJECT_STORAGE_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(process.env.APEX_OBJECT_STORAGE_SECRET_ACCESS_KEY || "").trim();
  const region = String(process.env.APEX_OBJECT_STORAGE_REGION || "auto").trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("Remote archive requires the configured APEX_OBJECT_STORAGE_* credentials");
  }
  return {
    bucket,
    client: new S3Client({
      endpoint,
      region: region || "auto",
      forcePathStyle: false,
      credentials: { accessKeyId, secretAccessKey }
    })
  };
}

async function hashRemoteBody(body) {
  if (!body) throw new Error("Remote archive read-back returned an empty body");
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of body) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: hash.digest("hex"), bytes };
}

/**
 * Preserve legacy /data/pgdata as a verified remote archive before optionally
 * removing the local copy. The source is never pruned unless the upload and
 * full remote read-back match, the tree stayed unchanged, and no PostgreSQL
 * process is running in this container.
 */
export async function archiveLegacyPgdata({ prune = false } = {}) {
  let info;
  try { info = await fs.lstat(target); }
  catch (error) {
    if (error.code === "ENOENT") return { skipped: true, reason: "legacy pgdata is already absent" };
    throw error;
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error("Refusing to archive or remove a non-directory or symlink at /data/pgdata");
  }
  const rootInfo = await fs.lstat(volumeRoot);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error("Refusing unsafe /data volume root");
  const [rootReal, targetReal] = await Promise.all([fs.realpath(volumeRoot), fs.realpath(target)]);
  if (path.dirname(targetReal) !== rootReal || targetReal !== path.join(rootReal, "pgdata")) {
    throw new Error("Legacy pgdata path escaped the expected /data volume");
  }

  const activeBefore = await activePostgresProcesses();
  if (activeBefore.length) {
    throw new Error("A PostgreSQL process is active; preserving /data/pgdata: " + JSON.stringify(activeBefore));
  }

  const before = await treeFingerprint(targetReal);
  const archive = path.join("/tmp", "apex-legacy-pgdata-" + process.pid + "-" + randomUUID() + ".tar.gz");
  let uploadedKey = null;
  try {
    await exec("tar", ["--numeric-owner", "-czf", archive, "-C", volumeRoot, "pgdata"], { timeout: 300000, maxBuffer: 1024 * 1024 });
    const local = await hashFile(archive);
    const { client, bucket } = objectStorageClient();
    uploadedKey = "apex-archives/legacy-pgdata/pgdata-" + new Date().toISOString().replace(/[:.]/g, "-") + "-" + local.sha256 + ".tar.gz";
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: uploadedKey,
      Body: createReadStream(archive),
      ContentLength: local.bytes,
      ContentType: "application/gzip",
      Metadata: {
        sha256: local.sha256,
        source: "legacy-pgdata",
        entries: String(before.entries),
        sourcebytes: String(before.bytes)
      }
    }));

    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: uploadedKey }));
    if (Number(head.ContentLength) !== local.bytes || String(head.Metadata?.sha256 || "") !== local.sha256) {
      throw new Error("Remote archive HEAD verification failed; local data preserved");
    }
    const downloaded = await client.send(new GetObjectCommand({ Bucket: bucket, Key: uploadedKey }));
    const remote = await hashRemoteBody(downloaded.Body);
    if (remote.bytes !== local.bytes || remote.sha256 !== local.sha256) {
      throw new Error("Remote archive SHA-256 read-back failed; local data preserved");
    }

    const after = await treeFingerprint(targetReal);
    if (before.sha256 !== after.sha256 || before.entries !== after.entries || before.bytes !== after.bytes) {
      throw new Error("Legacy pgdata changed during archive; verified archive retained but local data preserved");
    }

    if (!prune) {
      return { archived: true, pruned: false, bucket, key: uploadedKey, archiveBytes: local.bytes, archiveSha256: local.sha256, sourceEntries: before.entries, sourceBytes: before.bytes };
    }

    const activeBeforeDelete = await activePostgresProcesses();
    if (activeBeforeDelete.length) {
      throw new Error("A PostgreSQL process became active; verified archive retained and local data preserved");
    }
    await fs.rm(targetReal, { recursive: true, force: false });
    try {
      await fs.lstat(targetReal);
      throw new Error("Local pgdata still exists after prune attempt");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    let freeBytes = null;
    try {
      const statfs = await fs.statfs(volumeRoot);
      freeBytes = Number(statfs.bavail) * Number(statfs.bsize || statfs.frsize || 1);
    } catch {}
    return {
      archived: true,
      pruned: true,
      bucket,
      key: uploadedKey,
      archiveBytes: local.bytes,
      archiveSha256: local.sha256,
      sourceEntries: before.entries,
      sourceBytes: before.bytes,
      availableBytesAfterPrune: freeBytes
    };
  } finally {
    await fs.unlink(archive).catch(error => { if (error.code !== "ENOENT") console.error("[LEGACY_PGDATA_ARCHIVE] temporary archive cleanup failed", error.message); });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (String(process.env.APEX_ARCHIVE_LEGACY_PGDATA || "").toLowerCase() !== "true") {
    console.log("[LEGACY_PGDATA_ARCHIVE] skipped; archive flag is not enabled");
  } else {
    const prune = String(process.env.APEX_PRUNE_LEGACY_PGDATA || "").toLowerCase() === "true";
    try {
      console.log("[LEGACY_PGDATA_ARCHIVE]", JSON.stringify(await archiveLegacyPgdata({ prune })));
    } catch (error) {
      console.error("[LEGACY_PGDATA_ARCHIVE] failed; local source preserved", String(error?.stack || error));
      process.exitCode = 1;
    }
  }
}
