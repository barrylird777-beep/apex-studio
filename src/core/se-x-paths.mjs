import fs from "node:fs/promises";
import path from "node:path";

const SENSITIVE_SEGMENT = /^(?:\.env(?:\..*)?|\.git|\.ssh|\.aws|\.config|\.npmrc|\.netrc|\.bashrc|\.profile|id_rsa(?:\.pub)?|id_ed25519(?:\.pub)?)$/i;

function validateRelativePath(input, { allowHidden = false } = {}) {
  if (typeof input !== "string" || !input.length || input.includes("\0") || input.includes("\\")) {
    throw new TypeError("A safe relative project path is required");
  }
  if (path.posix.isAbsolute(input) || path.win32.isAbsolute(input) || /^[A-Za-z]:/.test(input)) {
    throw new TypeError("Absolute paths are not allowed");
  }
  const segments = input.split("/");
  if (segments.some(segment => !segment || segment === "." || segment === "..")) {
    throw new TypeError("Path traversal segments are not allowed");
  }
  for (const segment of segments) {
    if (SENSITIVE_SEGMENT.test(segment)) throw new TypeError("Sensitive system paths are not accessible");
    if (!allowHidden && segment.startsWith(".")) throw new TypeError("Hidden project paths are not accessible");
  }
  return segments;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
}

/**
 * Resolve a project-relative path and reject traversal, sensitive names, and
 * symlink components. Existing parent directories are required; only the final
 * file may be missing when allowMissingLeaf is true.
 *
 * root must be a trusted, pre-created storage root. For write operations, callers
 * should use exclusive temporary files and atomic rename where practical.
 */
export async function resolveContainedPath(root, input, {
  allowHidden = false,
  allowMissingLeaf = true,
  mustExist = false
} = {}) {
  const segments = validateRelativePath(input, { allowHidden });
  const rootReal = await fs.realpath(path.resolve(root));
  let current = rootReal;

  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    if (!isWithin(rootReal, current)) throw new TypeError("Resolved path escapes the project storage root");
    try {
      const info = await fs.lstat(current);
      if (info.isSymbolicLink()) throw new TypeError("Symlink paths are not allowed inside project storage");
      const actual = await fs.realpath(current);
      if (!isWithin(rootReal, actual)) throw new TypeError("Resolved path escapes the project storage root");
      current = actual;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const isLeaf = index === segments.length - 1;
      if (!isLeaf || mustExist || !allowMissingLeaf) throw new Error("Project path does not exist");
      break;
    }
  }

  if (mustExist) {
    await fs.lstat(current);
  }
  if (!isWithin(rootReal, current)) throw new TypeError("Resolved path escapes the project storage root");
  return current;
}

export async function ensureContainedDirectory(root, relativePath, { allowHidden = false } = {}) {
  const segments = validateRelativePath(relativePath, { allowHidden });
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const rootReal = await fs.realpath(path.resolve(root));
  let current = rootReal;
  for (const segment of segments) {
    current = path.join(current, segment);
    if (!isWithin(rootReal, current)) throw new TypeError("Directory escapes the project storage root");
    try {
      await fs.mkdir(current, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    const info = await fs.lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new TypeError("Project directory must not be a symlink or non-directory");
    current = await fs.realpath(current);
    if (!isWithin(rootReal, current)) throw new TypeError("Directory escapes the project storage root");
  }
  return current;
}
