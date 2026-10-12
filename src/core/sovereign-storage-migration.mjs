import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const sha256 = value => createHash("sha256").update(value).digest("hex");

async function copyMissing(source, destination, copied, destinationRoot) {
  const sourceInfo = await fs.lstat(source);
  if (sourceInfo.isSymbolicLink()) throw new Error(`Refusing symlink in sovereign storage migration: ${source}`);

  let destinationInfo;
  try { destinationInfo = await fs.lstat(destination); }
  catch (error) { if (error.code !== "ENOENT") throw error; }

  if (sourceInfo.isDirectory()) {
    if (destinationInfo && (!destinationInfo.isDirectory() || destinationInfo.isSymbolicLink())) {
      throw new Error(`Sovereign storage migration conflict at ${destination}; destination preserved.`);
    }
    if (!destinationInfo) await fs.mkdir(destination, { recursive: false, mode: sourceInfo.mode & 0o700 || 0o700 });
    for (const entry of await fs.readdir(source)) {
      await copyMissing(path.join(source, entry), path.join(destination, entry), copied, destinationRoot);
    }
    return;
  }

  if (!sourceInfo.isFile()) throw new Error(`Refusing non-regular sovereign storage entry: ${source}`);
  if (destinationInfo) {
    if (!destinationInfo.isFile() || destinationInfo.isSymbolicLink()) {
      throw new Error(`Sovereign storage migration conflict at ${destination}; destination preserved.`);
    }
    const [sourceBytes, destinationBytes] = await Promise.all([fs.readFile(source), fs.readFile(destination)]);
    if (sha256(sourceBytes) !== sha256(destinationBytes)) {
      throw new Error(`Sovereign storage migration conflict at ${destination}; different bytes preserved.`);
    }
    return;
  }

  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await fs.copyFile(source, destination, fs.constants?.COPYFILE_EXCL ?? 1);
  await fs.chmod(destination, sourceInfo.mode & 0o700 || 0o600);
  copied.push(path.relative(destinationRoot, destination));
}

export async function migrateSovereignStorage({
  sourceRoot = "/srv/apex/se-x",
  destination = process.env.APEX_SE_X_ROOT || "/srv/apex/se-x"
} = {}) {
  const source = path.resolve(sourceRoot);
  const destinationRoot = path.resolve(destination);
  if (source === destinationRoot) return { migrated: false, copied: [] };
  if (destinationRoot.startsWith(source + path.sep)) {
    throw new Error("Sovereign persistent root must not be nested inside the legacy source root.");
  }
  let sourceInfo;
  try { sourceInfo = await fs.lstat(source); }
  catch (error) {
    if (error.code === "ENOENT") {
      await fs.mkdir(destinationRoot, { recursive: true, mode: 0o700 });
      return { migrated: false, copied: [] };
    }
    throw error;
  }
  if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) {
    throw new Error("Legacy sovereign storage root must be a real directory.");
  }
  await fs.mkdir(destinationRoot, { recursive: true, mode: 0o700 });
  const destinationInfo = await fs.lstat(destinationRoot);
  if (!destinationInfo.isDirectory() || destinationInfo.isSymbolicLink()) {
    throw new Error("Persistent sovereign destination must be a real directory, not a symlink.");
  }
  const copied = [];
  for (const entry of await fs.readdir(source)) {
    await copyMissing(path.join(source, entry), path.join(destinationRoot, entry), copied, destinationRoot);
  }
  return { migrated: copied.length > 0, copied };
}
