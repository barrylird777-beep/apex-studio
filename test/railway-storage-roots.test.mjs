import test from "node:test";
import assert from "node:assert/strict";
import { configurePersistentStorageRoots } from "../src/core/railway-storage-roots.mjs";

test("Railway storage paths move under mounted volume and preserve subdirectories", () => {
  const env = {
    RAILWAY_VOLUME_MOUNT_PATH: "/data",
    APEX_SE_X_ROOT: "/tmp/apex-se-x",
    APEX_PROJECTS_DIR: "/tmp/apex-se-x/projects",
    APEX_SOVEREIGN_STORAGE_DIR: "/tmp/apex-se-x/projects",
    APEX_WAL_DIR: "/tmp/apex-se-x/wal",
    APEX_WAL_FILE: "/tmp/apex-se-x/wal/ring.wal.jsonl"
  };
  const result = configurePersistentStorageRoots(env);
  assert.equal(result.changed, true);
  assert.equal(env.APEX_SE_X_ROOT, "/data/se-x");
  assert.equal(env.APEX_PROJECTS_DIR, "/data/se-x/projects");
  assert.equal(env.APEX_SOVEREIGN_STORAGE_DIR, "/data/se-x/projects");
  assert.equal(env.APEX_WAL_DIR, "/data/se-x/wal");
  assert.equal(env.APEX_WAL_FILE, "/data/se-x/wal/ring.wal.jsonl");
});

test("Railway storage paths already on mounted volume remain unchanged", () => {
  const env = { RAILWAY_VOLUME_MOUNT_PATH: "/data", APEX_SE_X_ROOT: "/data/custom-root", APEX_PROJECTS_DIR: "/data/custom-root/projects" };
  const result = configurePersistentStorageRoots(env);
  assert.equal(result.changed, false);
  assert.equal(env.APEX_SE_X_ROOT, "/data/custom-root");
  assert.equal(env.APEX_PROJECTS_DIR, "/data/custom-root/projects");
});

test("local development without a mounted volume retains existing paths", () => {
  const env = { APEX_SE_X_ROOT: "/tmp/dev-root", APEX_PROJECTS_DIR: "/tmp/dev-root/projects" };
  const result = configurePersistentStorageRoots(env);
  assert.equal(result.changed, false);
  assert.equal(env.APEX_SE_X_ROOT, "/tmp/dev-root");
  assert.equal(env.APEX_PROJECTS_DIR, "/tmp/dev-root/projects");
});

test("unrelated custom paths are rebased to safe canonical locations", () => {
  const env = { RAILWAY_VOLUME_MOUNT_PATH: "/data", APEX_SE_X_ROOT: "/tmp/apex-se-x", APEX_PROJECTS_DIR: "/var/cache/apex-projects" };
  configurePersistentStorageRoots(env);
  assert.equal(env.APEX_PROJECTS_DIR, "/data/se-x/projects");
});
