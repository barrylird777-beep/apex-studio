import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AtomicDiskWriter } from "../src/core/ast/atomic-disk-writer.mjs";

test("atomic writer replaces target and leaves no sidecar", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "apex-atomic-"));
  const target = path.join(dir, "target.ts");
  try {
    await fs.writeFile(target, "// ORIGINAL SAFE CODE\n", "utf8");
    await AtomicDiskWriter.write(target, "// REPLACED CODE\n");
    assert.equal(await fs.readFile(target, "utf8"), "// REPLACED CODE\n");
    assert.deepEqual(await fs.readdir(dir), ["target.ts"]);
    await assert.rejects(AtomicDiskWriter.write(path.join(dir, "missing", "target.ts"), "new content"), /ENOENT/);
    assert.deepEqual(await fs.readdir(dir), ["target.ts"]);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
