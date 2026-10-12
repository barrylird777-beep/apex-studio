import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { migrateSovereignStorage } from "../src/core/sovereign-storage-migration.mjs";

test("persistent migration copies legacy files without replacing them and is restart-idempotent", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "apex-se-x-migration-"));
  const source = path.join(root, "legacy");
  const destination = path.join(root, "volume", "se-x");
  try {
    await fs.mkdir(path.join(source, "projects", ".sovereign-cas"), { recursive: true });
    await fs.mkdir(path.join(source, "identity"), { recursive: true });
    await fs.writeFile(path.join(source, "projects", ".sovereign-cas", "object.json"), '{"safe":true}\n');
    await fs.writeFile(path.join(source, "identity", "sovereign-peer.key"), "private-key-bytes");
    const first = await migrateSovereignStorage({ sourceRoot: source, destination });
    assert.equal(first.migrated, true);
    assert.equal(first.copied.length, 2);
    assert.equal(await fs.readFile(path.join(destination, "identity", "sovereign-peer.key"), "utf8"), "private-key-bytes");
    const second = await migrateSovereignStorage({ sourceRoot: source, destination });
    assert.equal(second.migrated, false);
    assert.deepEqual(second.copied, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("persistent migration fails closed on conflicting destination bytes and preserves both copies", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "apex-se-x-conflict-"));
  const source = path.join(root, "legacy");
  const destination = path.join(root, "volume", "se-x");
  try {
    await fs.mkdir(source, { recursive: true });
    await fs.mkdir(destination, { recursive: true });
    await fs.writeFile(path.join(source, "record.json"), "legacy-record");
    await fs.writeFile(path.join(destination, "record.json"), "volume-record");
    await assert.rejects(migrateSovereignStorage({ sourceRoot: source, destination }), /different bytes preserved/);
    assert.equal(await fs.readFile(path.join(source, "record.json"), "utf8"), "legacy-record");
    assert.equal(await fs.readFile(path.join(destination, "record.json"), "utf8"), "volume-record");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
