import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { Writable } from "node:stream";
import os from "node:os";
import path from "node:path";

test("asset streaming rejects traversal and symlink escapes while serving contained files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-media-root-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "apex-media-outside-"));
  const oldRoot = process.env.APEX_MEDIA_ROOT;
  try {
    await mkdir(path.join(root, "previews"));
    await writeFile(path.join(root, "previews", "clip.mp4"), "safe-media");
    await writeFile(path.join(outside, "secret.mp4"), "do-not-read");
    await symlink(outside, path.join(root, "outside"), "dir");
    process.env.APEX_MEDIA_ROOT = root;
    const { streamAsset } = await import("../src/api/asset-stream.mjs?test=" + Date.now());

    class Response extends Writable {
      constructor() { super(); this.headers = {}; this.status = null; this.body = []; }
      setHeader(name, value) { this.headers[name] = value; }
      writeHead(status, headers = {}) { this.status = status; Object.assign(this.headers, headers); }
      _write(chunk, encoding, callback) { this.body.push(Buffer.from(chunk)); callback(); }
    }
    const res = new Response();
    await new Promise((resolve, reject) => {
      res.on("finish", resolve); res.on("error", reject);
      Promise.resolve(streamAsset({ headers: {} }, res, ["previews", "clip.mp4"])).catch(reject);
    });
    assert.equal(res.status, 200);
    assert.equal(Buffer.concat(res.body).toString(), "safe-media");
    await assert.rejects(streamAsset({ headers: {} }, new Response(), ["..", "outside", "secret.mp4"]));
    await assert.rejects(streamAsset({ headers: {} }, new Response(), ["outside", "secret.mp4"]));
  } finally {
    if (oldRoot === undefined) delete process.env.APEX_MEDIA_ROOT;
    else process.env.APEX_MEDIA_ROOT = oldRoot;
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
