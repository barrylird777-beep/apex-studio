import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mountedVolume = process.env.RAILWAY_VOLUME_MOUNT_PATH ? path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH) : null;
const configuredStorageRoot = path.resolve(process.env.APEX_SE_X_ROOT || "/srv/apex/se-x");
const insideOrEqual = (parent, candidate) => {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
};

// Railway's writable container layer is ephemeral. If the configured sovereign
// root is outside the mounted volume, rebase local state paths onto the volume
// before importing modules that capture these environment variables at load time.
if (mountedVolume && !insideOrEqual(mountedVolume, configuredStorageRoot)) {
  const persistentRoot = path.join(mountedVolume, "se-x");
  const rebase = (key, fallback) => {
    const value = process.env[key];
    if (!value) {
      process.env[key] = fallback;
      return;
    }
    const resolved = path.resolve(value);
    if (insideOrEqual(mountedVolume, resolved)) return;
    const relative = path.relative(configuredStorageRoot, resolved);
    // Preserve an existing path's role (for example, "projects") when it
    // already lives under the old root; otherwise use the safe canonical path.
    process.env[key] = relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
      ? path.resolve(persistentRoot, relative)
      : fallback;
  };
  process.env.APEX_SE_X_ROOT = persistentRoot;
  rebase("APEX_PROJECTS_DIR", path.join(persistentRoot, "projects"));
  rebase("APEX_SOVEREIGN_STORAGE_DIR", path.join(persistentRoot, "projects"));
  rebase("APEX_WAL_DIR", path.join(persistentRoot, "wal"));
  rebase("APEX_WAL_FILE", path.join(persistentRoot, "wal", "ring.wal.jsonl"));
  console.warn("[APEX STACK] rebased non-persistent storage paths onto mounted volume", JSON.stringify({
    mountPath: mountedVolume,
    previousRoot: configuredStorageRoot,
    persistentRoot: process.env.APEX_SE_X_ROOT
  }));
}

const { migrateSovereignStorage } = await import("../src/core/sovereign-storage-migration.mjs");
const { reportStorageFootprint } = await import("./report-storage-footprint.mjs");
const { archiveLegacyPgdata } = await import("./archive-legacy-pgdata.mjs");
const apiScript = path.join(root, "server.mjs");
const runtimeScript = path.join(root, "src/core/sovereign-runtime-daemon.mjs");
const children = new Map();
// Reject readiness records left by a prior supervisor/process generation.
const runtimeInstanceId = randomUUID();
const childEnv = { ...process.env, APEX_RUNTIME_INSTANCE_ID: runtimeInstanceId };
let stopping = false;
let exitCode = 0;
let restartTimer;
let restartDelayMs = 1000;

function stopAll(code = 0, signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  clearTimeout(restartTimer);
  console.log("[APEX STACK] stopping services", JSON.stringify({ code, signal, drainDeadlineMs: 25000 }));
  for (const child of children.values()) {
    if (child && child.exitCode == null && child.signalCode == null) child.kill(signal);
  }
  const force = setTimeout(() => {
    for (const child of children.values()) {
      if (child && child.exitCode == null && child.signalCode == null) child.kill("SIGKILL");
    }
  }, 25000);
  force.unref?.();
}

function startApi() {
  const child = spawn(process.execPath, [apiScript], { cwd: root, env: childEnv, stdio: "inherit" });
  children.set("apex-api", child);
  console.log("[APEX STACK] started", JSON.stringify({ service: "apex-api", pid: child.pid }));
  child.on("error", error => {
    console.error("[APEX STACK] API failed to start", error);
    stopAll(1);
  });
  child.on("exit", (code, signal) => {
    console.error("[APEX STACK] API exited", JSON.stringify({ code, signal }));
    if (!stopping) stopAll(code ?? 1);
    finishIfStopped();
  });
}

function startRuntime() {
  if (stopping) return;
  const child = spawn(process.execPath, [runtimeScript], { cwd: root, env: childEnv, stdio: "inherit" });
  children.set("sovereign-runtime", child);
  console.log("[APEX STACK] started", JSON.stringify({ service: "sovereign-runtime", pid: child.pid }));
  child.on("error", error => {
    console.error("[APEX STACK] sovereign runtime failed to start", error);
    scheduleRuntimeRestart();
  });
  child.on("exit", (code, signal) => {
    console.error("[APEX STACK] sovereign runtime exited", JSON.stringify({ code, signal, apiRemainsAvailable: !stopping }));
    if (!stopping) scheduleRuntimeRestart();
    finishIfStopped();
  });
}

function scheduleRuntimeRestart() {
  if (stopping || restartTimer) return;
  restartTimer = setTimeout(() => {
    restartTimer = undefined;
    restartDelayMs = Math.min(30000, restartDelayMs * 2);
    startRuntime();
  }, restartDelayMs);
  restartTimer.unref?.();
  console.warn("[APEX STACK] sovereign runtime restart scheduled", JSON.stringify({ delayMs: restartDelayMs }));
}

function finishIfStopped() {
  if (stopping && [...children.values()].every(child => !child || child.exitCode != null || child.signalCode != null)) {
    process.exitCode = exitCode;
  }
}

process.once("SIGTERM", () => stopAll(0, "SIGTERM"));
process.once("SIGINT", () => stopAll(0, "SIGINT"));
try {
  const targetRoot = path.resolve(process.env.APEX_SE_X_ROOT || "/srv/apex/se-x");
  const legacyRoots = [...new Set([configuredStorageRoot, "/srv/apex/se-x"])]
    .filter(sourceRoot => path.resolve(sourceRoot) !== targetRoot);
  const copied = [];
  for (const sourceRoot of legacyRoots) {
    const migration = await migrateSovereignStorage({ sourceRoot, destination: targetRoot });
    copied.push(...migration.copied);
  }
  console.log("[APEX STACK] persistent sovereign storage ready", JSON.stringify({
    root: targetRoot,
    migrated: copied.length > 0,
    copiedFiles: copied.length
  }));
  if (String(process.env.APEX_ARCHIVE_LEGACY_PGDATA || "").toLowerCase() === "true") {
    try {
      const result = await archiveLegacyPgdata({ prune: String(process.env.APEX_PRUNE_LEGACY_PGDATA || "").toLowerCase() === "true" });
      console.log("[APEX STACK] legacy PostgreSQL archive result", JSON.stringify(result));
    } catch (error) {
      // Archival failure must never delete the source or prevent the application from starting.
      console.error("[APEX STACK] legacy PostgreSQL archive failed; source preserved", String(error?.stack || error));
    }
  }
  console.log("[APEX STACK] read-only storage footprint", JSON.stringify(await reportStorageFootprint()));
} catch (error) {
  console.error("[APEX STACK] persistent sovereign storage migration failed closed", error);
  process.exitCode = 1;
  throw error;
}
startApi();
startRuntime();
