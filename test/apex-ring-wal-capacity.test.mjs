import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ApexRingWAL } from "../src/core/apex-ring-wal.mjs";

test("WAL refuses an append that would exceed its byte cap without discarding records", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "apex-wal-cap-"));
  const file = path.join(dir, "ring.wal.jsonl");
  try {
    const wal = new ApexRingWAL({ file, maxBytes: 1024, ringSize: 16 });
    await wal.init();
    let rejected = false;
    for (let i = 0; i < 50; i++) {
      try { await wal.append("test.record", { index: i, text: "x".repeat(80) }); }
      catch (error) {
        assert.equal(error.code, "WAL_CAPACITY_EXCEEDED");
        rejected = true;
        break;
      }
    }
    assert.equal(rejected, true, "capacity should eventually reject a write");
    assert.ok((await stat(file)).size <= 1024, "WAL must never exceed configured cap");
    const text = await readFile(file, "utf8");
    assert.ok(text.includes('"type":"test.record"'), "previous records remain present");
    assert.equal(await wal.replay(), text.split("\n").filter(Boolean).length);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("WAL rejects a single record larger than the configured cap", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "apex-wal-record-"));
  const file = path.join(dir, "ring.wal.jsonl");
  try {
    const wal = new ApexRingWAL({ file, maxBytes: 1024 });
    await assert.rejects(
      wal.append("oversized", { text: "x".repeat(2000) }),
      error => error.code === "WAL_RECORD_TOO_LARGE"
    );
    let size = 0;
    try { size = (await stat(file)).size; } catch (error) { if (error.code !== "ENOENT") throw error; }
    assert.equal(size, 0, "oversized record must not be written");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
