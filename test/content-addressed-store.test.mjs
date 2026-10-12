import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ContentAddressedStore } from "../src/core/content-addressed-store.mjs";

test("content-addressed objects verify hashes and round-trip", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-cas-"));
  try {
    const store = await new ContentAddressedStore({ root }).init();
    const object = await store.putObject({ value: 7, nested: ["safe"] });
    assert.match(object.hash, /^[a-f0-9]{64}$/);
    assert.deepEqual(await store.getObject(object.hash), { value: 7, nested: ["safe"] });
    assert.equal((await store.putObject({ value: 7, nested: ["safe"] })).hash, object.hash);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("manifest updates are atomic and compare-and-swap guarded", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-cas-"));
  try {
    const store = await new ContentAddressedStore({ root }).init();
    const first = await store.writeRef("app", "record-1", { revision: 1 });
    assert.deepEqual((await store.readRef("app", "record-1")).value, { revision: 1 });
    await assert.rejects(
      store.writeRef("app", "record-1", { revision: 2 }, { expectedHash: "0".repeat(64) }),
      error => error.code === "CAS_CONFLICT"
    );
    const second = await store.writeRef("app", "record-1", { revision: 2 }, { expectedHash: first.hash });
    assert.notEqual(second.hash, first.hash);
    assert.deepEqual((await store.readRef("app", "record-1")).value, { revision: 2 });
    assert.equal(await store.deleteRef("app", "record-1", { expectedHash: second.hash }), true);
    assert.equal(await store.readRef("app", "record-1"), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("content-addressed storage does not create an append log", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "apex-cas-"));
  try {
    const store = await new ContentAddressedStore({ root }).init();
    await store.writeRef("app", "one", { ok: true });
    const names = await readdir(root);
    assert.deepEqual(names.sort(), ["objects", "refs"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
