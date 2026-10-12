import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createKernelodiesLibraryAuth } from "../src/api/kernelodies-auth.mjs";

async function start(getToken) {
  const app = express();
  app.get("/protected", createKernelodiesLibraryAuth({ getToken }), (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  return {
    url: "http://127.0.0.1:" + server.address().port + "/protected",
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  };
}

test("Kernelodies shared library fails closed and uses its own scoped token", async () => {
  let runtime = await start(() => undefined);
  try {
    const unavailable = await fetch(runtime.url);
    assert.equal(unavailable.status, 503);
  } finally { await runtime.close(); }

  runtime = await start(() => "library-only-secret");
  try {
    assert.equal((await fetch(runtime.url)).status, 401);
    assert.equal((await fetch(runtime.url, { headers: { "x-kernelodies-token": "wrong" } })).status, 401);
    const allowed = await fetch(runtime.url, { headers: { "x-kernelodies-token": "library-only-secret" } });
    assert.equal(allowed.status, 200);
    assert.deepEqual(await allowed.json(), { ok: true });
  } finally { await runtime.close(); }
});
