import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("object-storage mode preserves a local manifest", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "apex-storage-"));
  const old = {
    STORAGE_DIR: process.env.STORAGE_DIR,
    APEX_ASSET_STORAGE: process.env.APEX_ASSET_STORAGE
  };
  process.env.STORAGE_DIR = dir;
  process.env.APEX_ASSET_STORAGE = "s3";
  const mod = await import(`../src/core/storage.mjs?test=${Date.now()}`);
  await mod.initStorage();
  const state = await mod.getProjectState();
  assert.deepEqual(state, { assets: [], exports: [] });
  await fs.rm(dir, { recursive: true, force: true });
  if (old.STORAGE_DIR === undefined) delete process.env.STORAGE_DIR; else process.env.STORAGE_DIR = old.STORAGE_DIR;
  if (old.APEX_ASSET_STORAGE === undefined) delete process.env.APEX_ASSET_STORAGE; else process.env.APEX_ASSET_STORAGE = old.APEX_ASSET_STORAGE;
});