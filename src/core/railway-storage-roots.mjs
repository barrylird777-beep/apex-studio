import path from "node:path";

const insideOrEqual = (parent, candidate) => {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
};

/**
 * Rebase local storage roots onto a mounted Railway volume before importing
 * modules that capture these environment variables. Mutates only the supplied
 * environment object and never deletes or renames source data.
 */
export function configurePersistentStorageRoots(env = process.env) {
  const mountValue = String(env.RAILWAY_VOLUME_MOUNT_PATH || "").trim();
  if (!mountValue) return { changed: false, reason: "no-mounted-volume" };

  const mountPath = path.resolve(mountValue);
  const previousRoot = path.resolve(env.APEX_SE_X_ROOT || "/srv/apex/se-x");
  if (insideOrEqual(mountPath, previousRoot)) {
    return { changed: false, reason: "already-on-mounted-volume", mountPath, root: previousRoot };
  }

  const persistentRoot = path.join(mountPath, "se-x");
  const rebase = (key, fallback) => {
    const value = String(env[key] || "").trim();
    if (!value) {
      env[key] = fallback;
      return;
    }
    const resolved = path.resolve(value);
    if (insideOrEqual(mountPath, resolved)) return;
    const relative = path.relative(previousRoot, resolved);
    const preservesRole = relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
    env[key] = preservesRole ? path.resolve(persistentRoot, relative) : fallback;
  };

  env.APEX_SE_X_ROOT = persistentRoot;
  rebase("APEX_PROJECTS_DIR", path.join(persistentRoot, "projects"));
  rebase("APEX_SOVEREIGN_STORAGE_DIR", path.join(persistentRoot, "projects"));
  rebase("APEX_WAL_DIR", path.join(persistentRoot, "wal"));
  rebase("APEX_WAL_FILE", path.join(persistentRoot, "wal", "ring.wal.jsonl"));

  return { changed: true, mountPath, previousRoot, persistentRoot };
}
