import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveContainedPath, ensureContainedDirectory } from "../src/core/se-x-paths.mjs";

test("SE-X path resolver rejects traversal, absolute paths, Windows paths and hidden secrets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-se-x-paths-"));
  try {
    await assert.rejects(resolveContainedPath(root, "../../etc/passwd"), /traversal|relative/i);
    await assert.rejects(resolveContainedPath(root, "/etc/passwd"), /Absolute/);
    await assert.rejects(resolveContainedPath(root, "C:\\Windows\\win.ini"), /relative|Absolute/i);
    await assert.rejects(resolveContainedPath(root, ".env"), /Sensitive|Hidden/);
    await assert.rejects(resolveContainedPath(root, "nested/.env.production"), /Sensitive|Hidden/);
    await assert.rejects(resolveContainedPath(root, "folder/../secret.txt"), /traversal/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SE-X path resolver allows contained project files and rejects symlink escapes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-se-x-paths-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "apex-se-x-outside-"));
  try {
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", "ok.mp4"), "safe");
    assert.equal(await resolveContainedPath(root, "assets/ok.mp4", { mustExist: true }), path.join(root, "assets", "ok.mp4"));
    assert.equal(await resolveContainedPath(root, "assets/new.mp4"), path.join(root, "assets", "new.mp4"));
    await symlink(outside, path.join(root, "escape"), "dir");
    await assert.rejects(resolveContainedPath(root, "escape/secret.txt"), /Symlink|exist/i);
    await assert.rejects(ensureContainedDirectory(root, "escape/new"), /Symlink|directory/i);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
