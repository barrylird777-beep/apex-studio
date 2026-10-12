import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

test("range downloader completes parallel HTTP ranges with exact bytes and hash", async () => {
  const payload = crypto.randomBytes(256 * 1024);
  let active = 0;
  let peak = 0;
  const server = http.createServer((req, res) => {
    const range = /^bytes=(\d+)-(\d+)$/.exec(String(req.headers.range || ""));
    if (!range) { res.writeHead(200, {"Content-Length": payload.length}); return res.end(payload); }
    const start = Number(range[1]), end = Math.min(Number(range[2]), payload.length - 1);
    if (start >= payload.length || end < start) return res.writeHead(416).end();
    active++; peak = Math.max(peak, active);
    setTimeout(() => {
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${payload.length}`,
        "Content-Length": end - start + 1,
        "Accept-Ranges": "bytes",
        ETag: '"apex-test"'
      });
      res.end(payload.subarray(start, end + 1), () => { active--; });
    }, 2);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const dir = await mkdtemp(path.join(os.tmpdir(), "apex-range-"));
  try {
    const { downloadHttpAsset } = await import("../src/network/http-range-transfer.mjs");
    const result = await downloadHttpAsset(`http://127.0.0.1:${server.address().port}/asset`, path.join(dir, "asset.bin"), { parallelStreams: 4, chunkMiB: 0.03125 });
    assert.equal(result.bytes, payload.length);
    assert.deepEqual(await readFile(result.path), payload);
    assert.equal(result.sha256, crypto.createHash("sha256").update(payload).digest("hex"));
    assert.ok(peak > 1, `expected parallel ranges, peak=${peak}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
